import base64
from datetime import UTC, datetime

import cv2
import numpy as np
from fastapi import HTTPException
from firebase_admin import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from src.devices import service as device_service
from src.inference.postprocess import draw_confirmed
from src.streaming.service import Session


def accessible_devices(db, uid):
    user = db.collection("users").document(uid).get().to_dict() or {}
    for device_id in set(user.get("owned_device_ids", []) + user.get("shared_device_ids", [])):
        snapshot = db.collection("devices").document(device_id).get()
        if snapshot.exists and device_service.owns_or_views(snapshot.to_dict() or {}, uid):
            yield device_id


def list_alerts(db, uid, limit):
    result = []
    for device_id in accessible_devices(db, uid):
        query = (
            db.collection("alerts")
            .where(filter=FieldFilter("device_id", "==", device_id))
            .order_by("timestamp", direction=firestore.Query.DESCENDING)
            .limit(limit)
        )
        for doc in query.stream():
            result.append({**(doc.to_dict() or {}), "id": doc.id})
    result.sort(key=lambda item: item["timestamp"], reverse=True)
    return result[:limit]


def acknowledge_alert(db, uid, alert_id):
    ref = db.collection("alerts").document(alert_id)
    snapshot = ref.get()
    data = snapshot.to_dict() or {}
    if not snapshot.exists or not data.get("device_id"):
        raise HTTPException(404, "Alert not found")
    device = device_service.get_device(db, data["device_id"])
    if not device_service.owns_or_views(device, uid):
        raise HTTPException(404, "Alert not found")
    ref.update({"acknowledged_by": firestore.ArrayUnion([uid])})
    return {"ok": True}


def save_alert(db, session: Session, frame: np.ndarray, boxes: list) -> dict:
    device = device_service.get_device(db, session.device_id)
    rendered = draw_confirmed(frame.copy(), boxes)
    # Keep the entire JPEG in one Firestore document under its 1 MiB limit.
    height, width = rendered.shape[:2]
    if width > 640:
        rendered = cv2.resize(rendered, (640, round(height * 640 / width)))
    ok, encoded = cv2.imencode(".jpg", rendered, [cv2.IMWRITE_JPEG_QUALITY, 65])  
    if not ok:
        raise ValueError("Could not encode alert frame")
    image = base64.b64encode(encoded.tobytes()).decode("ascii")
    if len(image) > 700_000:
        raise ValueError("Alert frame exceeds safe Firestore document size")
    alert = {
        "device_id": session.device_id,
        "device_name": device.get("name", "Camera"),
        "timestamp": datetime.now(UTC),
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
    ref = db.collection("alerts").document()
    ref.set(alert)
    return {"id": ref.id, **alert, "timestamp": alert["timestamp"].isoformat()}
