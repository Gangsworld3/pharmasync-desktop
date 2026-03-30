from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from app.api.responses import success_response
from app.api.deps import SessionDep, get_current_user
from app.core.config import settings
from app.core.rate_limiter import rate_limiter
from app.db.models import User
from app.services.auth_service import authenticate, refresh_access_token


router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


@router.post("/login")
def login(payload: LoginRequest, request: Request, session: SessionDep):
    client_ip = request.client.host if request.client else "unknown"
    key = f"auth:login:{client_ip}"
    if not rate_limiter.allow(
        key,
        limit=settings.auth_login_limit_per_minute,
        window_seconds=60,
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Try again later.",
        )
    try:
        tokens = authenticate(session, payload.email, payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    return success_response(
        {
            "access_token": tokens.access_token,
            "refresh_token": tokens.refresh_token,
            "role": tokens.role,
            "tenant_id": tokens.tenant_id,
            "token_type": tokens.token_type,
        }
    )


@router.post("/refresh")
def refresh(payload: RefreshRequest, request: Request, session: SessionDep):
    client_ip = request.client.host if request.client else "unknown"
    key = f"auth:refresh:{client_ip}"
    if not rate_limiter.allow(
        key,
        limit=settings.auth_refresh_limit_per_minute,
        window_seconds=60,
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many refresh attempts. Try again later.",
        )
    try:
        tokens = refresh_access_token(session, payload.refresh_token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    return success_response(
        {
            "access_token": tokens.access_token,
            "refresh_token": tokens.refresh_token,
            "role": tokens.role,
            "tenant_id": tokens.tenant_id,
            "token_type": tokens.token_type,
        }
    )


@router.get("/me")
def auth_me(current_user: User = Depends(get_current_user)):
    return success_response(
        {
            "id": current_user.id,
            "email": current_user.email,
            "role": current_user.role,
            "tenant_id": current_user.tenant_id,
            "is_active": current_user.is_active,
        }
    )
