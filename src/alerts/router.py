from typing import Annotated

from fastapi import APIRouter, Query

from src.alerts import service
from src.alerts.schemas import AlertResponse
from src.auth.dependencies import CurrentUser
from src.database import Database
from src.models import Success

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("", response_model=list[AlertResponse], summary="List alerts from accessible cameras")
def list_alerts(uid: CurrentUser, db: Database, limit: Annotated[int, Query(ge=1, le=100)] = 50):
    return service.list_alerts(db, uid, limit)


@router.post(
    "/{alert_id}/acknowledge", response_model=Success, summary="Acknowledge an accessible alert"
)
def acknowledge_alert(alert_id: str, uid: CurrentUser, db: Database):
    return service.acknowledge_alert(db, uid, alert_id)
