import argparse
import asyncio
import base64
import hashlib
import logging
import os
import secrets
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import cv2
import firebase_admin
import numpy as np
import uvicorn
from fastapi import FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from firebase_admin import auth, credentials, firestore
from pydantic import BaseModel, Field
from ultralytics import YOLO

from postprocess import TemporalBuffer, draw_confirmed, yolo_result_to_raw

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

DEFAULT_WEIGHTS = "best.engine"
VIOLENCE_THRESHOLD = float(os.getenv("VIOLENCE_THRESHOLD", "0.6"))
# VIOLENCE_SECONDS = float(os.getenv("VIOLENCE_SECONDS", "3"))
ALERT_COOLDOWN_SECONDS = float(os.getenv("ALERT_COOLDOWN_SECONDS", "30"))
FRAME_TIMEOUT_SECONDS = float(os.getenv("FRAME_TIMEOUT_SECONDS", "15"))
INFERENCE_BATCH_SIZE = max(1, int(os.getenv("INFERENCE_BATCH_SIZE", "4")))
FRAME_QUEUE_SIZE = max(INFERENCE_BATCH_SIZE, int(os.getenv("FRAME_QUEUE_SIZE", "12")))
VIOLENCE_CLASSES = ("violence",)

app = FastAPI(title="Detex API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
model: YOLO | None = None
model_lock = asyncio.Lock()          #**************
db = None


@dataclass
class Session:
    device_id: str
    session_id: str
    camera_socket: WebSocket | None = None
    viewer_sockets: dict[str, WebSocket] = field(default_factory=dict)
    frame_socket: WebSocket | None = None
    inference_buffer: TemporalBuffer = field(
        default_factory=lambda: TemporalBuffer(window=8, min_hits=3, ema_alpha=0.4)
    )
    violence_since: float | None = None
    last_alert_at: float = 0
    frame_queue: asyncio.Queue[tuple[np.ndarray, int]] = field(
        default_factory=lambda: asyncio.Queue(maxsize=FRAME_QUEUE_SIZE)
    )
    inference_task: asyncio.Task[None] | None = None
    last_frame_at: float | None = None


sessions: dict[str, Session] = {}
device_sessions: dict[str, Session] = {}


def _db():
    if db is None:
        raise HTTPException(503, "Firebase is not configured")
    return db


def _uid(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Firebase ID token required")
    try:
        return auth.verify_id_token(authorization[7:])["uid"]
    except Exception as exc:
        raise HTTPException(401, "Invalid Firebase ID token") from exc


def _device(device_id: str) -> dict:
    snapshot = _db().collection("devices").document(device_id).get()
    if not snapshot.exists:
        raise HTTPException(404, "Camera not found")
    return snapshot.to_dict() or {}


def _owns_or_views(device: dict, uid: str) -> bool:
    return uid == device.get("owner_uid") or uid in device.get("paired_viewer_uids", [])


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _camera_authorized(device: dict, token: str) -> bool:
    stored = device.get("camera_token_hash", "")
    return bool(stored and token) and secrets.compare_digest(stored, _token_hash(token))
#***************

def _ensure_session(device_id: str) -> Session:
    existing = device_sessions.get(device_id)
    if existing:
        return existing
    session = Session(device_id=device_id, session_id=secrets.token_urlsafe(18))
    sessions[session.session_id] = session
    device_sessions[device_id] = session
    return session


def _public_device(device_id: str, device: dict) -> dict:
    session = device_sessions.get(device_id)
    frame_active = bool(
        session
        and session.frame_socket
        and session.last_frame_at is not None
        and time.monotonic() - session.last_frame_at <= FRAME_TIMEOUT_SECONDS
    )
    return {
        "device_id": device_id,
        "name": device.get("name", "Camera"),
        "location": device.get("location", ""),
        "session_id": session.session_id if session else None,
        "state": "online" if frame_active else "offline",
    }


class RegisterBody(BaseModel):
    device_id: str | None = None
    camera_token: str | None = None
    name: str = Field(default="Camera", max_length=80)
    location: str = Field(default="", max_length=120)


class PairBody(BaseModel):
    pairing_code: str = Field(min_length=8, max_length=128)


@app.post("/api/devices/register")
def register_device(body: RegisterBody, authorization: str | None = Header(default=None)):
    uid = _uid(authorization) if authorization else None
    if body.device_id:
        device = _device(body.device_id)
        if not _camera_authorized(device, body.camera_token or ""):
            raise HTTPException(403, "Invalid camera token")
        device_id = body.device_id
        camera_token = body.camera_token
    else:
        if not uid:
            raise HTTPException(401, "Sign in to create a camera")
        device_id = secrets.token_urlsafe(12)
        camera_token = secrets.token_urlsafe(32)
        pairing_code = secrets.token_urlsafe(18)
        device = {
            "owner_uid": uid,
            "name": body.name.strip() or "Camera",
            "location": body.location.strip(),
            "camera_token_hash": _token_hash(camera_token),
            "pairing_code_hash": _token_hash(pairing_code),
            "paired_viewer_uids": [uid],
            "created_at": firestore.SERVER_TIMESTAMP,
        }
        _db().collection("devices").document(device_id).set(device)
        _db().collection("users").document(uid).set(
            {"owned_device_ids": firestore.ArrayUnion([device_id])}, merge=True
        )
    session = _ensure_session(device_id)
    return {
        **_public_device(device_id, device),
        "session_id": session.session_id,      #**********
        "camera_token": camera_token,
        "pairing_code": pairing_code if not body.device_id else None,
    }


@app.post("/api/devices/{device_id}/pair")
def pair_device(device_id: str, body: PairBody, authorization: str | None = Header(default=None)):
    uid = _uid(authorization)
    device = _device(device_id)
    if not secrets.compare_digest(
        device.get("pairing_code_hash", ""), _token_hash(body.pairing_code.strip())
    ):
        raise HTTPException(403, "Invalid pairing code")
    _db().collection("devices").document(device_id).update(
        {"paired_viewer_uids": firestore.ArrayUnion([uid])}
    )
    if device.get("owner_uid") != uid:
        _db().collection("users").document(uid).set(
            {"shared_device_ids": firestore.ArrayUnion([device_id])}, merge=True
        )
    return {"ok": True}


@app.post("/api/devices/{device_id}/share-code")
def rotate_share_code(device_id: str, authorization: str | None = Header(default=None)):
    uid = _uid(authorization)
    device = _device(device_id)
    if device.get("owner_uid") != uid:
        raise HTTPException(403, "Only the owner can share this camera")
    code = secrets.token_urlsafe(18)
    _db().collection("devices").document(device_id).update(
        {"pairing_code_hash": _token_hash(code)}
    )
    return {"pairing_code": code}


@app.post("/api/devices/{device_id}/camera-token")
async def rotate_camera_token(device_id: str, authorization: str | None = Header(default=None)):
    uid = await asyncio.to_thread(_uid, authorization)
    device = await asyncio.to_thread(_device, device_id)
    if device.get("owner_uid") != uid:
        raise HTTPException(403, "Only the owner can reset the camera link")
    token = secrets.token_urlsafe(32)
    await asyncio.to_thread(
        _db().collection("devices").document(device_id).update,
        {"camera_token_hash": _token_hash(token)},
    )
    """Close old camera session"""
    session = device_sessions.get(device_id)
    if session:
        old_camera, old_frames = session.camera_socket, session.frame_socket
        session.camera_socket = None
        session.frame_socket = None
        session.violence_since = None
        for socket in (old_camera, old_frames):
            if socket:
                try:
                    await socket.close() #that's why use async func
                except Exception:
                    pass
        await _state(session)
    return {"camera_token": token, "session_id": session.session_id if session else None}


@app.get("/api/users/me/devices")
def list_devices(authorization: str | None = Header(default=None)):
    uid = _uid(authorization)
    user = _db().collection("users").document(uid).get().to_dict() or {}
    ids = list(dict.fromkeys(
        user.get("owned_device_ids", []) + user.get("shared_device_ids", [])
    ))   #trick to get unique device id
    result = []
    """maybe error when a camera's deleted"""
    for device_id in ids:
        device = _device(device_id)
        result.append(_public_device(device_id, device))
        # doc = _db().collection("devices").document(device_id).get()
        # if doc.exists and _owns_or_views(doc.to_dict() or {}, uid):
        #     result.append(_public_device(device_id, doc.to_dict() or {}))
    return result


@app.get("/api/alerts")
def list_alerts(
    limit: int = Query(default=50, ge=1, le=100),
    authorization: str | None = Header(default=None),
):
    uid = _uid(authorization)
    user = _db().collection("users").document(uid).get().to_dict() or {}
    ids = set(user.get("owned_device_ids", []) + user.get("shared_device_ids", []))
    if not ids:
        return []
    result = []
    for device_id in ids:
        # if not _owns_or_views(_device(device_id), uid): ********
        #     continue
        query = _db().collection("alerts").where("device_id", "==", device_id)
        for doc in query.stream():
            data = doc.to_dict() or {}
            timestamp = data.get("timestamp")
            result.append({
                "id": doc.id,
                **data
                # "timestamp": timestamp.isoformat() if timestamp else None,
            })
    result.sort(key=lambda item: item["timestamp"] or "", reverse=True)
    return result[:limit]


@app.post("/api/alerts/{alert_id}/acknowledge")
def acknowledge_alert(alert_id: str, authorization: str | None = Header(default=None)):
    uid = _uid(authorization)
    ref = _db().collection("alerts").document(alert_id)
    # doc = ref.get()
    # if not doc.exists or not _owns_or_views(_device(doc.to_dict()["device_id"]), uid):
    #     raise HTTPException(404, "Alert not found")
    ref.update({"acknowledged_by": firestore.ArrayUnion([uid])})
    return {"ok": True}


async def _send(ws: WebSocket, payload: dict) -> None:
    try:
        await ws.send_json(payload)
    except Exception:
        pass


async def _state(session: Session) -> None:
    frame_active = bool(
        session.frame_socket
        and session.last_frame_at is not None
        and time.monotonic() - session.last_frame_at <= FRAME_TIMEOUT_SECONDS
    )
    payload = {
        "type": "session_state",
        "camera_connected": frame_active,
        "viewer_count": len(session.viewer_sockets),
    }
    for socket in [*session.viewer_sockets.values(), session.camera_socket]:
        if socket:
            await _send(socket, payload)


async def _authorize_ws(ws: WebSocket, session_id: str, role: str) -> Session | None:
    session = sessions.get(session_id)
    if not session:
        await ws.close(code=4404)
        return None
    try:
        device = await asyncio.to_thread(_device, session.device_id)
        if role == "camera":
            valid = _camera_authorized(device, ws.query_params.get("camera_token", ""))
        elif role == "viewer":
            uid = await asyncio.to_thread(_uid, "Bearer " + ws.query_params.get("id_token", ""))
            valid = _owns_or_views(device, uid)
        else:
            valid = False
    except HTTPException:
        valid = False
    if not valid:
        await ws.close(code=4403)
        return None
    return session


@app.websocket("/ws/sessions/{session_id}")
async def signaling(ws: WebSocket, session_id: str):
    await ws.accept() #handshake
    role = ws.query_params.get("role", "")
    session = await _authorize_ws(ws, session_id, role)
    if not session:
        return
    viewer_id = secrets.token_urlsafe(8)
    if role == "camera":
        if session.camera_socket:
            await ws.close(code=4409)
            return
        session.camera_socket = ws
    else:
        session.viewer_sockets[viewer_id] = ws
    await _send(ws, {"type": "ready", "viewer_id": viewer_id if role == "viewer" else None})
    if role == "camera":
        for existing_viewer_id in session.viewer_sockets:
            await _send(ws, {"type": "viewer_joined", "viewer_id": existing_viewer_id})
    elif role == "viewer" and session.camera_socket: #new viewer
        await _send(session.camera_socket, {"type": "viewer_joined", "viewer_id": viewer_id})
    await _state(session)
    try:
        while True:
            if role == "camera" and session.camera_socket is not ws:
                break
            message = await ws.receive_json()
            kind = message.get("type")
            if kind == "ping":
                await _send(ws, {"type": "pong"})
                continue
            if kind not in ("offer", "answer", "ice"):
                continue
            payload = {"type": kind, "data": message.get("data")}
            if role == "camera":
                target = message.get("viewer_id")
                if target in session.viewer_sockets:
                    await _send(session.viewer_sockets[target], payload)
            elif session.camera_socket:
                await _send(session.camera_socket, {**payload, "viewer_id": viewer_id})
    except WebSocketDisconnect:
        pass
    finally:
        if role == "camera":
            session.camera_socket = None 
        else :
            session.viewer_sockets.pop(viewer_id, None)
            if session.camera_socket:
                await _send(session.camera_socket, {"type": "viewer_left", "viewer_id": viewer_id})
        await _state(session)


def _save_alert(session: Session, frame: np.ndarray, boxes: list) -> dict:
    device = _device(session.device_id)
    rendered = draw_confirmed(frame.copy(), boxes)
    # Keep the entire JPEG in one Firestore document under its 1 MiB limit.
    height, width = rendered.shape[:2]
    if width > 640:
        rendered = cv2.resize(rendered, (640, round(height * 640 / width)))
    ok, encoded = cv2.imencode(".jpg", rendered, [cv2.IMWRITE_JPEG_QUALITY, 65]) #(h,w,3) to (n,)
    if not ok:
        raise ValueError("Could not encode alert frame")
    image = base64.b64encode(encoded.tobytes()).decode("ascii")
    if len(image) > 700_000:
        raise ValueError("Alert frame exceeds safe Firestore document size")
    alert = {
        "device_id": session.device_id,
        "device_name": device.get("name", "Camera"),
        "timestamp": datetime.now(timezone.utc),
        "confidence": round(max(box.conf_ema for box in boxes), 3),
        "detection_class": "violence",
        "thumbnail_b64": image,
        "boxes": [
            {
                "class": box.cls_name,
                "conf": round(box.conf_ema, 3),
                "bbox": [round(float(v), 1) for v in box.xyxy_ema],
            }
            for box in boxes
        ],
        "acknowledged_by": [],
    }
    ref = _db().collection("alerts").document()
    ref.set(alert)
    return {"id": ref.id, **alert, "timestamp": alert["timestamp"].isoformat()}


@app.websocket("/ws/sessions/{session_id}/frames")
async def frames(ws: WebSocket, session_id: str):
    await ws.accept()
    session = await _authorize_ws(ws, session_id, "camera")
    if not session:
        return
    if session.frame_socket:
        await ws.close(code=4409)
        return
    session.frame_socket = ws
    await _state(session)
    frame_idx = 0

    async def infer_batch(batch: list[tuple[np.ndarray, int]]) -> None:
        try:
            if model is None:
                return
            frames = [frame for frame, _ in batch]
            async with model_lock:
                results = await asyncio.to_thread(
                    model.predict, frames, conf=0.35, verbose=False
                )
            for (frame, index), result in zip(batch, results):
                confirmed = session.inference_buffer.update(yolo_result_to_raw(result))
                detections = [
                    {
                        "class": box.cls_name,
                        "conf": round(box.conf_ema, 3),
                        "bbox": [round(float(v), 1) for v in box.xyxy_ema],
                    }
                    for box in confirmed
                ]
                frame_jpeg = None
                if session.viewer_sockets:
                    ok, enc = cv2.imencode(
                        ".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 55]
                    )
                    if ok:
                        frame_jpeg = base64.b64encode(enc.tobytes()).decode("ascii")

                for viewer in list(session.viewer_sockets.values()):
                    await _send(viewer, {"type": "detections", "data": {
                        "frame": index,
                        "width": frame.shape[1],
                        "height": frame.shape[0],
                        "detections": detections,
                        "frame_jpeg": frame_jpeg,
                    }})
                violence = [
                    box for box in confirmed
                    if box.conf_ema >= VIOLENCE_THRESHOLD
                    and any(word in box.cls_name.lower() for word in VIOLENCE_CLASSES)
                ]
                now = time.monotonic()
                if violence and now - session.last_alert_at >= ALERT_COOLDOWN_SECONDS:
                    session.last_alert_at = now
                    alert = await asyncio.to_thread(
                        _save_alert, session, frame, violence
                    )
                    for viewer in list(session.viewer_sockets.values()):
                        await _send(viewer, {"type": "alert", "data": {
                            "id": alert["id"],
                            "device_id": alert["device_id"],
                            "device_name": alert["device_name"],
                            "timestamp": alert["timestamp"],
                            "confidence": alert["confidence"],
                        }})
        except Exception:
            log.exception("Inference failed for camera %s", session.device_id)

    async def inference_worker() -> None:
        while True:
            first = await session.frame_queue.get()
            batch = [first]
            while len(batch) < INFERENCE_BATCH_SIZE:
                try:
                    batch.append(session.frame_queue.get_nowait())
                except asyncio.QueueEmpty:
                    break
            await infer_batch(batch)
            for _ in batch:
                session.frame_queue.task_done()

    session.inference_task = asyncio.create_task(inference_worker())

    try:
        while True:
            if session.frame_socket is not ws:
                break
            data = await asyncio.wait_for(
                ws.receive_bytes(), timeout=FRAME_TIMEOUT_SECONDS
            )
            if len(data) > 2_000_000:
                continue
            frame = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
            if frame is not None:
                was_frame_active = bool(
                    session.last_frame_at is not None
                    and time.monotonic() - session.last_frame_at <= FRAME_TIMEOUT_SECONDS
                )
                session.last_frame_at = time.monotonic()
                if not was_frame_active:
                    await _state(session)
                item = (frame.copy(), frame_idx)
                if session.frame_queue.full():
                    try:
                        session.frame_queue.get_nowait()
                        session.frame_queue.task_done()
                    except asyncio.QueueEmpty:
                        pass
                session.frame_queue.put_nowait(item)
            frame_idx += 1
    except asyncio.TimeoutError:
        log.info("Frame stream timed out for camera %s", session.device_id)
    except WebSocketDisconnect:
        pass
    finally:
        if session.frame_socket is ws:
            session.frame_socket = None
            session.violence_since = None
            session.last_frame_at = None
            session.inference_buffer = TemporalBuffer(window=8, min_hits=3, ema_alpha=0.4)
            if session.inference_task:
                session.inference_task.cancel()
                session.inference_task = None
            while not session.frame_queue.empty():
                try:
                    session.frame_queue.get_nowait()
                    session.frame_queue.task_done()
                except asyncio.QueueEmpty:
                    break
            await _state(session)


@app.on_event("startup")
def startup():
    global db, model
    # Hugging Face Spaces
    raw_json = os.getenv("FIREBASE_CREDENTIALS_JSON")
    if raw_json:
        import json
        cred = credentials.Certificate(json.loads(raw_json))
    # Local dev
    else:
        credential_path = os.getenv("FIREBASE_SERVICE_ACCOUNT", "detex.json")
        if Path(credential_path).exists():
            cred = credentials.Certificate(credential_path)
        else:
            cred = credentials.ApplicationDefault()
    try:
        firebase_admin.get_app()  # guard against double-init on dev reload
    except ValueError:
        firebase_admin.initialize_app(cred)
    db = firestore.client()
    weights = getattr(app.state, "weights", DEFAULT_WEIGHTS)
    model = YOLO(weights)
    log.info("Model loaded: %s", weights)
    log.info("Firebase and YOLO ready")


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", default=8765, type=int)
    parser.add_argument("--weights", default=DEFAULT_WEIGHTS)
    parser.add_argument("--ssl-cert", default="cert.crt")
    parser.add_argument("--ssl-key", default="cert.key")
    parser.add_argument("--no-ssl", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    app.state.weights = args.weights
    cert = Path(args.ssl_cert)
    key = Path(args.ssl_key)
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        ssl_certfile=str(cert) if not args.no_ssl and cert.exists() and key.exists() else None,
        ssl_keyfile=str(key) if not args.no_ssl and cert.exists() and key.exists() else None,
    )
