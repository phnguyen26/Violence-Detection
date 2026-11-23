import asyncio
import hashlib
import secrets

from fastapi import HTTPException, WebSocketDisconnect
from firebase_admin import firestore

from src.devices.schemas import PairBody, RegisterBody
from src.streaming import service as streaming_service


def get_device(db, device_id: str) -> dict:
    snapshot = db.collection("devices").document(device_id).get()
    if not snapshot.exists:
        raise HTTPException(404, "Camera not found")
    return snapshot.to_dict() or {}


def owns_or_views(device: dict, uid: str) -> bool:
    return uid == device.get("owner_uid") or uid in device.get("paired_viewer_uids", [])


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def camera_authorized(device: dict, token: str) -> bool:
    stored = device.get("camera_token_hash", "")
    return bool(stored and token) and secrets.compare_digest(stored, token_hash(token))


def register_device(body: RegisterBody, uid: str | None, db):
    if body.device_id:
        device = get_device(db, body.device_id)
        if not camera_authorized(device, body.camera_token or ""):
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
            "camera_token_hash": token_hash(camera_token),
            "pairing_code_hash": token_hash(pairing_code),
            "paired_viewer_uids": [uid],
            "created_at": firestore.SERVER_TIMESTAMP,
        }
        db.collection("devices").document(device_id).set(device)
        db.collection("users").document(uid).set(
            {"owned_device_ids": firestore.ArrayUnion([device_id])}, merge=True
        )
    session = streaming_service.ensure_session(device_id)
    return {
        **streaming_service.public_device(device_id, device),
        "session_id": session.session_id,
        "camera_token": camera_token,
        "pairing_code": pairing_code if not body.device_id else None,
    }


def pair_device(device_id: str, body: PairBody, uid: str | None, db):
    device = get_device(db, device_id)
    if not secrets.compare_digest(
        device.get("pairing_code_hash", ""), token_hash(body.pairing_code.strip())
    ):
        raise HTTPException(403, "Invalid pairing code")
    db.collection("devices").document(device_id).update(
        {"paired_viewer_uids": firestore.ArrayUnion([uid])}
    )
    if device.get("owner_uid") != uid:
        db.collection("users").document(uid).set(
            {"shared_device_ids": firestore.ArrayUnion([device_id])}, merge=True
        )
    return {"ok": True}


def rotate_share_code(device_id: str, uid: str | None, db):
    device = get_device(db, device_id)
    if device.get("owner_uid") != uid:
        raise HTTPException(403, "Only the owner can share this camera")
    code = secrets.token_urlsafe(18)
    db.collection("devices").document(device_id).update({"pairing_code_hash": token_hash(code)})
    return {"pairing_code": code}


async def rotate_camera_token(device_id: str, uid: str, db):
    device = await asyncio.to_thread(get_device, db, device_id)
    if device.get("owner_uid") != uid:
        raise HTTPException(403, "Only the owner can reset the camera link")
    token = secrets.token_urlsafe(32)
    await asyncio.to_thread(
        db.collection("devices").document(device_id).update,
        {"camera_token_hash": token_hash(token)},
    )
    session = streaming_service.device_sessions.get(device_id)
    if session:
        old_camera, old_frames = session.camera_socket, session.frame_socket
        session.camera_socket = None
        session.frame_socket = None
        for socket in (old_camera, old_frames): #closing old sockets
            if socket:
                try:
                    await socket.close()
                except (RuntimeError, WebSocketDisconnect):
                    pass
        await streaming_service.publish_state(session)
    return {"camera_token": token, "session_id": session.session_id if session else None}


def list_devices(uid: str | None, db):
    user = db.collection("users").document(uid).get().to_dict() or {}
    ids = list(dict.fromkeys(user.get("owned_device_ids", []) + user.get("shared_device_ids", [])))
    result = []
    for device_id in ids:
        snapshot = db.collection("devices").document(device_id).get()
        device = snapshot.to_dict() or {}
        if snapshot.exists and owns_or_views(device, uid):
            result.append(streaming_service.public_device(device_id, device))
    return result
