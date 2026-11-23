from typing import Annotated

from fastapi import Depends, Header, HTTPException
from fastapi.concurrency import run_in_threadpool
from firebase_admin import auth


def verify_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Firebase ID token required")
    try:
        return auth.verify_id_token(authorization[7:])["uid"]
    except (
        auth.InvalidIdTokenError,
        auth.RevokedIdTokenError,
        auth.UserDisabledError,
        ValueError,
    ) as exc:
        raise HTTPException(401, "Invalid Firebase ID token") from exc


async def optional_user(authorization: Annotated[str | None, Header()] = None) -> str | None:
    return await run_in_threadpool(verify_token, authorization) if authorization else None


async def current_user(authorization: Annotated[str | None, Header()] = None) -> str:
    return await run_in_threadpool(verify_token, authorization)


CurrentUser = Annotated[str, Depends(current_user)]
OptionalUser = Annotated[str | None, Depends(optional_user)]
