from datetime import datetime

from pydantic import BaseModel, Field


class Detection(BaseModel):
    class_: str = Field(alias="class")
    conf: float
    bbox: tuple[float, float, float, float]


class AlertResponse(BaseModel):
    id: str
    device_id: str
    device_name: str
    timestamp: datetime
    confidence: float
    detection_class: str
    thumbnail_b64: str
    boxes: list[Detection]
    acknowledged_by: list[str]
