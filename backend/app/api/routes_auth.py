from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.api.responses import success_response
from app.api.deps import SessionDep
from app.services.auth_service import authenticate


router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/login")
def login(payload: LoginRequest, session: SessionDep):
    try:
        token = authenticate(session, payload.email, payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    return success_response({"access_token": token, "token_type": "bearer"})
