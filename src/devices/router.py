from fastapi import APIRouter

from src.auth.dependencies import CurrentUser, OptionalUser
from src.database import Database
from src.devices import service
from src.devices.schemas import (
    CameraToken,
    DeviceResponse,
    PairBody,
    RegisterBody,
    RegisteredDevice,
    ShareCode,
)
from src.models import Success

router = APIRouter(tags=["devices"])


@router.post(
    "/api/devices/register", response_model=RegisteredDevice, summary="Create or reconnect a camera"
)
def register_device(body: RegisterBody, uid: OptionalUser, db: Database):
    return service.register_device(body, uid, db)


@router.post(
    "/api/devices/{device_id}/pair",
    response_model=Success,
    summary="Pair a viewer using a share code",
)
def pair_device(device_id: str, body: PairBody, uid: CurrentUser, db: Database):
    return service.pair_device(device_id, body, uid, db)


@router.post(
    "/api/devices/{device_id}/share-code",
    response_model=ShareCode,
    summary="Rotate an owned camera's share code",
)
def rotate_share_code(device_id: str, uid: CurrentUser, db: Database):
    return service.rotate_share_code(device_id, uid, db)


@router.post(
    "/api/devices/{device_id}/camera-token",
    response_model=CameraToken,
    summary="Rotate a camera token and disconnect its camera",
)
async def rotate_camera_token(device_id: str, uid: CurrentUser, db: Database):
    return await service.rotate_camera_token(device_id, uid, db)


@router.get(
    "/api/users/me/devices", response_model=list[DeviceResponse], summary="List accessible cameras"
)
def list_devices(uid: CurrentUser, db: Database):
    return service.list_devices(uid, db)
