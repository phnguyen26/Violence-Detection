import argparse
import asyncio
import base64
import json
import logging
import secrets
import string
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from ultralytics import YOLO

from postprocess import TemporalBuffer, draw_confirmed, yolo_result_to_raw

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s"
)
log = logging.getLogger(__name__)

DEFAULT_WEIGHTS = "best.pt"
SESSION_TTL_SECONDS = 600

app = FastAPI(title="Violence-Detection WebSocket Server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

model: YOLO | None = None  # loaded at startup


@dataclass
class Session:
  """Short-lived pairing session for the browser UI.
  """

  session_id: str
  pairing_code: str
  camera_token: str
  viewer_token: str
  created_at: float = field(default_factory=time.time)
  expires_at: float = field(
    default_factory=lambda: time.time() + SESSION_TTL_SECONDS
  )
  state: Literal["waiting", "connected", "ended"] = "waiting"
  camera_socket: WebSocket | None = field(default=None, repr=False)
  viewer_sockets: dict[str, WebSocket] = field(default_factory=dict, repr=False)
  pending_viewer_ice: dict[str, list[dict[str, object]]] = field(default_factory=dict, repr=False)
  inference_buffer: TemporalBuffer = field(
    default_factory=lambda: TemporalBuffer(window=6, min_hits=2, ema_alpha=0.4),
    repr=False,
  )


class SessionCreateResponse(BaseModel):
  session_id: str
  pairing_code: str
  camera_token: str
  viewer_token: str
  join_url: str
  expires_at: int
  state: str


class SessionStatusResponse(BaseModel):
  session_id: str
  pairing_code: str
  expires_at: int
  state: str


class SessionJoinRequest(BaseModel):
  pairing_code: str


class SessionJoinResponse(BaseModel):
  session_id: str
  join_url: str
  expires_at: int


sessions: dict[str, Session] = {}


def _remove_expired_sessions() -> None:
  now = time.time()
  expired_ids = [
    session_id
    for session_id, session in sessions.items()
    if session.expires_at <= now or session.state == "ended"
  ]
  for session_id in expired_ids:
    sessions.pop(session_id, None)


def _new_pairing_code() -> str:
  alphabet = string.ascii_uppercase + string.digits
  return "-".join(
    "".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(2)
  )


def _session_or_404(session_id: str) -> Session:
  _remove_expired_sessions()
  session = sessions.get(session_id)
  if session is None:
    raise HTTPException(status_code=404, detail="Session not found or expired")
  return session


def _close_code_for_session(session_id: str) -> int:
  return 4404 if session_id not in sessions else 4401


def _authorized_role(session: Session, role: str, token: str) -> bool:
  expected = {
    "camera": session.camera_token,
    "viewer": session.viewer_token,
  }.get(role)
  return expected is not None and secrets.compare_digest(token, expected)


async def _send_signal(ws: WebSocket, payload: dict[str, object]) -> bool:
  try:
    await ws.send_json(payload)
  except Exception:
    return False
  return True


async def _broadcast_session_state(session: Session) -> None:
  state = {
    "type": "session_state",
    "state": session.state,
    "camera_connected": session.camera_socket is not None,
    "viewer_count": len(session.viewer_sockets),
  }
  sockets = list(session.viewer_sockets.values())
  if session.camera_socket is not None:
    sockets.append(session.camera_socket)
  for socket in sockets:
    await _send_signal(socket, state)


async def _broadcast_detection(session: Session, payload: dict[str, object]) -> None:
  for viewer in list(session.viewer_sockets.values()):
    await _send_signal(viewer, {"type": "detections", "data": payload})


# async def _broadcast_frame(session: Session, frame: bytes) -> None:
#   """Relay JPEG to connected viewers as a JSON base64"""
#   frame_b64 = base64.b64encode(frame).decode()
#   payload = json.dumps({"type": "frame", "data": frame_b64})
#   for viewer in list(session.viewer_sockets.values()):
#     try:
#       await viewer.send_text(payload)
#     except Exception:
#       pass


@app.websocket("/ws/sessions/{session_id}")
async def session_signaling(ws: WebSocket, session_id: str) -> None:
  """Relay WebRTC signaling between one camera and session viewers.

  Media still travels through the eventual WebRTC peer connection. This
  socket carries only SDP, ICE candidates, and connection state.
  """
  await ws.accept()
  session = sessions.get(session_id)
  role = ws.query_params.get("role", "")
  token = ws.query_params.get("token", "")

  if session is None or session.expires_at <= time.time() or session.state == "ended":
    await ws.close(code=_close_code_for_session(session_id))
    return
  if role not in ("camera", "viewer") or not _authorized_role(session, role, token):
    await ws.close(code=4403)
    return

  socket_id = secrets.token_urlsafe(8)
  if role == "camera":
    if session.camera_socket is not None:
      await ws.close(code=4409)
      return
    session.camera_socket = ws
  else:
    session.viewer_sockets[socket_id] = ws
    session.pending_viewer_ice[socket_id] = []

  session.state = "connected"
  log.info("%s joined signaling session %s", role, session_id)
  await _send_signal(ws, {"type": "ready", "role": role, "session_id": session_id})
  await _broadcast_session_state(session)

  try:
    while True:
      message = await ws.receive_json()
      message_type = message.get("type")
      if message_type == "ping":
        await _send_signal(ws, {"type": "pong"})
        continue
      if message_type not in ("offer", "answer", "ice", "camera_ready"):
        await _send_signal(ws, {"type": "error", "message": "Unsupported signaling message"})
        continue

      payload = {
        "type": message_type,
        "from": role,
        "data": message.get("data"),
      }
      if role == "camera":
        for viewer in list(session.viewer_sockets.values()):
          await _send_signal(viewer, payload)
      elif role == "viewer" and message_type == "ice":
        session.pending_viewer_ice.setdefault(socket_id, []).append(payload)
      elif session.camera_socket is not None:
        await _send_signal(session.camera_socket, payload)
        if message_type == "answer":
          for candidate in session.pending_viewer_ice.get(socket_id, []):
            await _send_signal(session.camera_socket, candidate)
          session.pending_viewer_ice[socket_id] = []
  except WebSocketDisconnect:
    log.info("%s left signaling session %s", role, session_id)
  except Exception as exc:
    log.exception("Signaling error for session %s: %s", session_id, exc)
  finally:
    if role == "camera" and session.camera_socket is ws:
      session.camera_socket = None
    else:
      session.viewer_sockets.pop(socket_id, None)
      session.pending_viewer_ice.pop(socket_id, None)
    if session.camera_socket is None and not session.viewer_sockets:
      session.state = "waiting"
    await _broadcast_session_state(session)


@app.websocket("/ws/sessions/{session_id}/frames")
async def session_frames(ws: WebSocket, session_id: str) -> None:
  """
  YOLO runs in a thread-pool task; if the previous inference is still
   running the current frame is skipped (no queue build-up).
  """
  await ws.accept()
  session = sessions.get(session_id)
  role = ws.query_params.get("role", "")
  token = ws.query_params.get("token", "")
  if session is None or session.expires_at <= time.time() or session.state == "ended":
    await ws.close(code=_close_code_for_session(session_id))
    return
  if role != "camera" or not _authorized_role(session, role, token):
    await ws.close(code=4403)
    return

  frame_idx = 0
  inferencing = [False]  # mutable flag safe for asyncio single-thread model

  async def run_yolo(frame_arr: np.ndarray, idx: int) -> None:
    inferencing[0] = True
    try:
      results = await asyncio.to_thread(
        model.predict,
        frame_arr,
        conf=0.35,
        tracker="bytetrack.yaml",
        verbose=False,
      )
      raw = yolo_result_to_raw(results[0])
      confirmed = session.inference_buffer.update(raw)
      payload = {
        "frame": idx,
        "detections": [
          {
            "class": box.cls_name,
            "conf": round(box.conf_ema, 3),
            "bbox": [round(v, 1) for v in box.xyxy_ema.tolist()],
          }
          for box in confirmed
        ],
        "raw_detections": [
          {
            "class": det.cls_name,
            "conf": round(det.conf, 3),
            "bbox": [round(v, 1) for v in det.xyxy],
          }
          for det in raw
        ],
      }
      log.info(
        "Session %s frame %d — raw=%d confirmed=%d",
        session_id, idx, len(raw), len(confirmed),
      )
      await _broadcast_detection(session, payload)
    except Exception as exc:
      log.exception("YOLO error on session %s frame %d: %s", session_id, idx, exc)
    finally:
      inferencing[0] = False

  try:
    while True:
      data = await ws.receive_bytes()
      nparr = np.frombuffer(data, np.uint8)
      frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
      if frame is None:
        frame_idx += 1
        continue

      # Run YOLO concurrently; skip this frame if inference is busy 
      if not inferencing[0]:
        asyncio.create_task(run_yolo(frame.copy(), frame_idx))

      frame_idx += 1
  except WebSocketDisconnect:
    log.info("Camera inference stream ended for session %s", session_id)
  except Exception as exc:
    log.exception("Inference stream error for session %s: %s", session_id, exc)


@app.on_event("startup")
def load_model() -> None:
    global model
    weights = getattr(app.state, "weights", DEFAULT_WEIGHTS)
    log.info("Loading YOLO model from %s ...", weights)
    model = YOLO(weights)
    log.info("Model ready.")


@app.post("/api/sessions", response_model=SessionCreateResponse, status_code=201)
def create_session() -> SessionCreateResponse:
  """Create a short-lived room for one camera and its viewer(s)."""
  _remove_expired_sessions()
  session_id = secrets.token_urlsafe(16)
  session = Session(
    session_id=session_id,
    pairing_code=_new_pairing_code(),
    camera_token=secrets.token_urlsafe(32),
    viewer_token=secrets.token_urlsafe(32),
  )
  sessions[session_id] = session
  return SessionCreateResponse(
    session_id=session.session_id,
    pairing_code=session.pairing_code,
    camera_token=session.camera_token,
    viewer_token=session.viewer_token,
    join_url=f"/camera/{session.session_id}?token={session.camera_token}",
    expires_at=int(session.expires_at),
    state=session.state,
  )


@app.post("/api/sessions/join", response_model=SessionJoinResponse)
def join_session(request: SessionJoinRequest) -> SessionJoinResponse:
  """Resolve a short pairing code."""
  _remove_expired_sessions()
  normalized_code = request.pairing_code.strip().upper()
  session = next(
    (candidate for candidate in sessions.values() if candidate.pairing_code == normalized_code),
    None,
  )
  if session is None:
    raise HTTPException(status_code=404, detail="Pairing code not found or expired")
  return SessionJoinResponse(
    session_id=session.session_id,
    join_url=f"/camera/{session.session_id}?token={session.camera_token}",
    expires_at=int(session.expires_at),
  )


@app.get("/api/sessions/{session_id}", response_model=SessionStatusResponse)
def get_session(session_id: str) -> SessionStatusResponse:
  session = _session_or_404(session_id)
  return SessionStatusResponse(
    session_id=session.session_id,
    pairing_code=session.pairing_code,
    expires_at=int(session.expires_at),
    state=session.state,
  )


@app.delete("/api/sessions/{session_id}", status_code=204)
def end_session(session_id: str) -> None:
  """Revoke both camera and viewer access immediately."""
  session = _session_or_404(session_id)
  session.state = "ended"
  _remove_expired_sessions()



# CLI entry point
def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Violence-detection WebSocket server")
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", default=8765, type=int)
    p.add_argument("--weights", default=DEFAULT_WEIGHTS)
    p.add_argument(
        "--ssl-cert",
        default="cert.crt",
        help="TLS certificate file (default: cert.crt)",
    )
    p.add_argument(
        "--ssl-key",
        default="cert.key",
        help="TLS private key file  (default: cert.key)",
    )
    p.add_argument(
        "--no-ssl",
        action="store_true",
        help="Disable HTTPS (HTTP only, camera won't work on phones)",
    )
    p.add_argument(
        "--reload", action="store_true"
    )
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()
    app.state.weights = args.weights

    ssl_cert = None
    ssl_key = None
    if not args.no_ssl:
        cert_path = Path(args.ssl_cert)
        key_path = Path(args.ssl_key)
        if cert_path.exists() and key_path.exists():
            ssl_cert = str(cert_path)
            ssl_key = str(key_path)
        else:
            log.warning(
                "SSL cert/key not found (%s, %s). "
                "Run:  openssl req -x509 -newkey rsa:2048 -keyout cert.key -out cert.crt "
                "-days 365 -nodes -subj '/CN=YOUR_IP'  "
                "Or use --no-ssl (camera won't work on phones without HTTPS).",
                cert_path,
                key_path,
            )

    uvicorn.run(
        "server:app",
        host=args.host,
        port=args.port,
        ssl_certfile=ssl_cert,
        ssl_keyfile=ssl_key,
        reload=args.reload,
    )
