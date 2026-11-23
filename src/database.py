import json
from pathlib import Path
from typing import Annotated

import firebase_admin
from fastapi import Depends, HTTPException, Request
from firebase_admin import credentials, firestore
from google.cloud.firestore import Client

from src.auth.config import settings


def initialize_firebase() -> Client:
    try:
        firebase_admin.get_app()
    except ValueError:
        if settings.credentials_json:
            cred = credentials.Certificate(json.loads(settings.credentials_json))
        elif Path(settings.service_account).is_file():
            cred = credentials.Certificate(settings.service_account)
        else:
            cred = credentials.ApplicationDefault()
        firebase_admin.initialize_app(cred)
    return firestore.client()


async def get_db(request: Request) -> Client:
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise HTTPException(503, "Firebase is not configured")
    return db


Database = Annotated[Client, Depends(get_db)]
