from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlmodel import Session

from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from app.core.security_alerts import emit_security_alert
from app.db.models import User
from app.db.repos import (
    append_audit_log,
    create_refresh_token_record,
    get_active_by_id,
    get_refresh_token_by_hash,
    get_user_by_email,
    revoke_all_refresh_tokens_for_user,
    revoke_refresh_token,
)
from app.services.background_dispatcher import dispatcher


@dataclass
class AuthTokens:
    access_token: str
    refresh_token: str
    role: str
    tenant_id: str
    token_type: str = "bearer"


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


def _issue_token_pair(session: Session, user: User) -> AuthTokens:
    access_token = create_access_token(str(user.id), user.role, tenant_id=user.tenant_id)
    refresh_token, jti, expires_at = create_refresh_token(str(user.id), user.role, tenant_id=user.tenant_id)
    create_refresh_token_record(
        session,
        user_id=user.id or 0,
        token_hash=hash_refresh_token(refresh_token),
        jti=jti,
        expires_at=expires_at,
    )
    return AuthTokens(
        access_token=access_token,
        refresh_token=refresh_token,
        role=user.role,
        tenant_id=user.tenant_id,
    )


def authenticate(session: Session, email: str, password: str) -> AuthTokens:
    user = get_user_by_email(session, email)
    if not user or not user.is_active or not verify_password(password, user.password_hash):
        raise ValueError("Invalid email or password.")
    try:
        tokens = _issue_token_pair(session, user)
        append_audit_log(
            session,
            action="Auth.LOGIN",
            table_name="users",
            record_id=str(user.id),
            user_id=user.id,
            actor_role=user.role,
            tenant_id=user.tenant_id,
            payload={"email": user.email},
        )
        session.commit()
        return tokens
    except Exception:
        session.rollback()
        raise


def refresh_access_token(session: Session, refresh_token: str) -> AuthTokens:
    payload = decode_token(refresh_token, expected_type="refresh")
    token_hash = hash_refresh_token(refresh_token)
    token_record = get_refresh_token_by_hash(session, token_hash)

    if not token_record:
        raise ValueError("Invalid refresh token.")
    if token_record.revoked_at is not None:
        compromised_user = get_active_by_id(session, User, token_record.user_id)
        revoked_count = revoke_all_refresh_tokens_for_user(session, token_record.user_id)
        append_audit_log(
            session,
            action="Auth.REFRESH_REPLAY_DETECTED",
            table_name="users",
            record_id=str(token_record.user_id),
            user_id=token_record.user_id,
            actor_role=compromised_user.role if compromised_user else None,
            tenant_id=compromised_user.tenant_id if compromised_user else "default",
            payload={"revoked_sessions": revoked_count},
        )
        session.commit()
        dispatcher.submit(
            emit_security_alert,
            event="Auth.REFRESH_REPLAY_DETECTED",
            payload={
                "user_id": token_record.user_id,
                "reason": "revoked_token_reuse",
                "revoked_sessions": revoked_count,
            },
        )
        raise ValueError("Refresh token has been revoked.")
    if token_record.expires_at <= datetime.now(UTC):
        raise ValueError("Refresh token has expired.")
    if token_record.jti != payload.get("jti"):
        compromised_user = get_active_by_id(session, User, token_record.user_id)
        revoked_count = revoke_all_refresh_tokens_for_user(session, token_record.user_id)
        append_audit_log(
            session,
            action="Auth.REFRESH_REPLAY_DETECTED",
            table_name="users",
            record_id=str(token_record.user_id),
            user_id=token_record.user_id,
            actor_role=compromised_user.role if compromised_user else None,
            tenant_id=compromised_user.tenant_id if compromised_user else "default",
            payload={"reason": "jti_mismatch", "revoked_sessions": revoked_count},
        )
        session.commit()
        dispatcher.submit(
            emit_security_alert,
            event="Auth.REFRESH_REPLAY_DETECTED",
            payload={
                "user_id": token_record.user_id,
                "reason": "jti_mismatch",
                "revoked_sessions": revoked_count,
            },
        )
        raise ValueError("Refresh token mismatch.")

    user = get_active_by_id(session, User, token_record.user_id)
    if not user:
        raise ValueError("User not found or inactive.")

    try:
        new_tokens = _issue_token_pair(session, user)
        new_token_record = get_refresh_token_by_hash(session, hash_refresh_token(new_tokens.refresh_token))
        revoke_refresh_token(
            session,
            token_record,
            replaced_by_token_id=new_token_record.id if new_token_record else None,
        )
        append_audit_log(
            session,
            action="Auth.REFRESH",
            table_name="users",
            record_id=str(user.id),
            user_id=user.id,
            actor_role=user.role,
            tenant_id=user.tenant_id,
            payload={"rotated": True},
        )
        session.commit()
        return new_tokens
    except Exception:
        session.rollback()
        raise
