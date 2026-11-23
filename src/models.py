from pydantic import BaseModel


class Success(BaseModel):
    ok: bool


class ErrorResponse(BaseModel):
    detail: str
