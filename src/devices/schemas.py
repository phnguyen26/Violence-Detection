from typing import Literal

from pydantic import BaseModel, Field

"""
    register for a new camera (viewer)
    or register as a camera (phone)
"""
class RegisterBody(BaseModel):
    device_id: str | None = Field(
        default=None, min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$"
    )
    camera_token: str | None = Field(default=None, min_length=1, max_length=256)
    name: str = Field(default="Camera", max_length=80)
    location: str = Field(default="", max_length=120)


class PairBody(BaseModel):
    pairing_code: str = Field(min_length=8, max_length=128)


class DeviceResponse(BaseModel):
    device_id: str
    name: str
    location: str
    session_id: str | None
    state: Literal["online", "offline"]


class RegisteredDevice(DeviceResponse):
    camera_token: str
    pairing_code: str | None


class ShareCode(BaseModel):
    pairing_code: str


class CameraToken(BaseModel):
    camera_token: str
    session_id: str | None
