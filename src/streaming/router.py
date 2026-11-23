import asyncio
import base64
import logging
import secrets
import time

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from google.api_core.exceptions import GoogleAPICallError

from src.alerts import service as alert_service
from src.auth.dependencies import verify_token
from src.devices import service as device_service
from src.inference.config import settings
from src.inference.postprocess import TemporalBuffer
from src.inference.service import predict
from src.streaming.service import Session, publish_state, sessions
from src.streaming.service import send as _send

router = APIRouter(tags=["streaming"])
log = logging.getLogger(__name__)
FRAME_TIMEOUT_SECONDS = settings.frame_timeout_seconds
INFERENCE_BATCH_SIZE = settings.inference_batch_size
VIOLENCE_THRESHOLD = settings.violence_threshold
ALERT_COOLDOWN_SECONDS = settings.alert_cooldown_seconds
VIOLENCE_CLASSES = ("violence",)


async def _authorize_ws(ws: WebSocket, session_id: str, role: str) -> Session | None:
    session = sessions.get(session_id)
    if not session:
        await ws.close(code=4404)
        return None
    try:
        device = await asyncio.to_thread(
            device_service.get_device, ws.app.state.db, session.device_id
        )
        if role == "camera":
            valid = device_service.camera_authorized(
                device, ws.query_params.get("camera_token", "")
            )
        elif role == "viewer":
            uid = await asyncio.to_thread(
                verify_token, "Bearer " + ws.query_params.get("id_token", "")
            )
            valid = device_service.owns_or_views(device, uid)
        else:
            valid = False
    except HTTPException:
        valid = False
    if not valid:
        await ws.close(code=4403)
        return None
    return session


@router.websocket("/ws/sessions/{session_id}")
async def signaling(ws: WebSocket, session_id: str):
    await ws.accept()  # handshake
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
    elif role == "viewer" and session.camera_socket:  # new viewer
        await _send(session.camera_socket, {"type": "viewer_joined", "viewer_id": viewer_id})
    await publish_state(session)
    try:
        while True:
            if role == "camera" and session.camera_socket is not ws:
                break
            message = await ws.receive_json()
            if not isinstance(message, dict):
                await ws.close(code=1003)
                break
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
    except ValueError:
        await ws.close(code=1003)
    finally:
        if role == "camera":
            if session.camera_socket is ws:
                session.camera_socket = None
        else:
            session.viewer_sockets.pop(viewer_id, None)
            log.info(
                "Viewer disconnected: viewer_id=%s session_id=%s",
                viewer_id,
                session.session_id,
                extra={"viewer_id": viewer_id, "session_id": session.session_id},
            )
            if session.camera_socket:
                await _send(session.camera_socket, {"type": "viewer_left", "viewer_id": viewer_id})
        await publish_state(session)


@router.websocket("/ws/sessions/{session_id}/frames")
async def frames(ws: WebSocket, session_id: str):
    await ws.accept()
    session = await _authorize_ws(ws, session_id, "camera")
    if not session:
        return
    if session.frame_socket:
        await ws.close(code=4409) # Session already has a frame socket
        return
    session.frame_socket = ws
    await publish_state(session)
    frame_idx = 0

    async def infer_batch(batch: list[tuple[np.ndarray, int]]) -> None:
        try:
            frames = [frame for frame, _ in batch]
            results = await asyncio.get_running_loop().run_in_executor(
                ws.app.state.inference_pool, predict, frames
            )
            for (frame, index), raw in zip(batch, results):
                confirmed = session.inference_buffer.update(raw)
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
                    ok, enc = await asyncio.to_thread(
                        cv2.imencode, ".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 55]
                    )
                    if ok:
                        frame_jpeg = base64.b64encode(enc.tobytes()).decode("ascii")

                for viewer in list(session.viewer_sockets.values()):
                    await _send(
                        viewer,
                        {
                            "type": "detections",
                            "data": {
                                "frame": index,
                                "width": frame.shape[1],
                                "height": frame.shape[0],
                                "detections": detections,
                                "frame_jpeg": frame_jpeg,
                            },
                        },
                    )
                violence = [
                    box
                    for box in confirmed
                    if box.conf_ema >= VIOLENCE_THRESHOLD
                    and any(word in box.cls_name.lower() for word in VIOLENCE_CLASSES)
                ]
                now = time.monotonic()
                if violence and now - session.last_alert_at >= ALERT_COOLDOWN_SECONDS:
                    alert = await asyncio.to_thread(
                        alert_service.save_alert, ws.app.state.db, session, frame, violence
                    )
                    session.last_alert_at = now #update after save to firestore  
                    for viewer in list(session.viewer_sockets.values()):
                        await _send(
                            viewer,
                            {
                                "type": "alert",
                                "data": {
                                    "id": alert["id"],
                                    "device_id": alert["device_id"],
                                    "device_name": alert["device_name"],
                                    "timestamp": alert["timestamp"],
                                    "confidence": alert["confidence"],
                                },
                            },
                        )
        except (RuntimeError, ValueError, cv2.error, GoogleAPICallError, HTTPException):
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
            try:
                await infer_batch(batch)
            finally:
                for _ in batch:
                    session.frame_queue.task_done()

    worker = asyncio.create_task(inference_worker())
    session.inference_task = worker

    try:
        while True:
            if session.frame_socket is not ws:
                break
            data = await asyncio.wait_for(ws.receive_bytes(), timeout=FRAME_TIMEOUT_SECONDS)
            if len(data) > 2_000_000:
                continue
            frame = await asyncio.to_thread(
                cv2.imdecode, np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR
            )
            if frame is not None:
                was_frame_active = bool(
                    session.last_frame_at is not None
                    and time.monotonic() - session.last_frame_at <= FRAME_TIMEOUT_SECONDS
                )
                session.last_frame_at = time.monotonic()
                if not was_frame_active:
                    await publish_state(session)
                item = (frame.copy(), frame_idx)
                if session.frame_queue.full():
                    try:
                        session.frame_queue.get_nowait()
                        session.frame_queue.task_done()
                    except asyncio.QueueEmpty:
                        pass
                session.frame_queue.put_nowait(item)
            frame_idx += 1
    except TimeoutError:
        log.info("Frame stream timed out for camera %s", session.device_id)
    except WebSocketDisconnect:
        pass
    finally:
        worker.cancel()
        await asyncio.gather(worker, return_exceptions=True)
        if session.frame_socket is ws:
            session.frame_socket = None
            session.last_frame_at = None
            session.inference_buffer = TemporalBuffer(window=8, min_hits=3, ema_alpha=0.4)
            session.inference_task = None
            while not session.frame_queue.empty():
                try:
                    session.frame_queue.get_nowait()
                    session.frame_queue.task_done()
                except asyncio.QueueEmpty:
                    break
            await publish_state(session)
