from __future__ import annotations

from sqlmodel import Session

from app.core.config import settings
from app.core.security import create_access_token, hash_password, verify_password
from app.db.models import User
from app.db.repositories import get_user_by_email


def ensure_default_admin(session: Session) -> None:
    admin = get_user_by_email(session, settings.default_admin_email)
    if admin:
        return

    session.add(
        User(
            full_name="PharmaSync Administrator",
            email=settings.default_admin_email,
            password_hash=hash_password(settings.default_admin_password),
            role="admin",
            is_active=True,
        )
    )
    session.commit()


def authenticate(session: Session, email: str, password: str) -> str:
    user = get_user_by_email(session, email)
    if not user or not user.is_active or not verify_password(password, user.password_hash):
        raise ValueError("Invalid email or password.")
    return create_access_token(str(user.id), user.role)
