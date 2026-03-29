from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlmodel import Session

from app.core.security import decode_access_token
from app.db.database import get_session
from app.db.models import User
from app.db.repositories import get_active_by_id


SessionDep = Annotated[Session, Depends(get_session)]
security = HTTPBearer()


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)],
    request: Request,
    session: SessionDep,
) -> User:
    try:
        payload = decode_access_token(credentials.credentials)
        user = get_active_by_id(session, User, int(payload["sub"]))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.") from exc

    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive user.")
    request.state.user_id = user.id
    return user


def require_role(*allowed_roles: str):
    allowed = {role.strip().lower() for role in allowed_roles if role}

    def checker(user: Annotated[User, Depends(get_current_user)]) -> User:
        user_role = (user.role or "").strip().lower()
        if allowed and user_role not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role.")
        return user

    return checker
