import asyncio
import logging
import secrets
import time
from dataclasses import dataclass, field
from threading import RLock

import numpy as np
from fastapi import WebSocket, WebSocketDisconnect

from src.inference.config import settings
from src.inference.postprocess import TemporalBuffer

FRAME_QUEUE_SIZE = settings.frame_queue_size
FRAME_TIMEOUT_SECONDS = settings.frame_timeout_seconds
registry_lock = RLock()
log = logging.getLogger(__name__)
import os
log.setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())


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
    last_alert_at: float = 0
    frame_queue: asyncio.Queue[tuple[np.ndarray, int]] = field(
        default_factory=lambda: asyncio.Queue(maxsize=FRAME_QUEUE_SIZE)
    )
    inference_task: asyncio.Task[None] | None = None #used when app shutting down
    last_frame_at: float | None = None


sessions: dict[str, Session] = {}
device_sessions: dict[str, Session] = {}


def ensure_session(device_id: str) -> Session:
    with registry_lock:
        session = _ensure_session(device_id)
        log.debug(
            "Ensured streaming session",
            extra={"device_id": device_id, "session_id": session.session_id},
        )
        return session


def _ensure_session(device_id: str) -> Session:
    existing = device_sessions.get(device_id)
    if existing:
        log.info(
            "Reusing existing streaming session",
            extra={"device_id": device_id, "session_id": existing.session_id},
        )
        return existing
    session = Session(device_id=device_id, session_id=secrets.token_urlsafe(18))
    sessions[session.session_id] = session
    device_sessions[device_id] = session
    log.info(
        "Created streaming session",
        extra={"device_id": device_id, "session_id": session.session_id},
    )
    return session


def public_device(device_id: str, device: dict) -> dict:
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


async def send(ws: WebSocket, payload: dict) -> None:
    payload_type = payload.get("type", "unknown")
    query_params = getattr(ws, "query_params", None)
    role = query_params.get("role", "unknown") if query_params else "unknown"
    log.debug(
        "Sending WebSocket payload: type=%s role=%s",
        payload_type,
        role,
        extra={"payload_type": payload_type, "role": role},
    )
    try:
        await ws.send_json(payload)
    except (WebSocketDisconnect, RuntimeError, OSError) as exc:
        log.warning(
            "WebSocket closed while sending: type=%s role=%s error=%s",
            payload_type,
            role,
            exc,
            extra={"payload_type": payload_type, "role": role, "error": str(exc)},
            exc_info=True,
        ) ##


async def publish_state(session: Session) -> None:
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
            await send(socket, payload)
