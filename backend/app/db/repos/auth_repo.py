from __future__ import annotations

from datetime import datetime

from sqlmodel import Session, select

from app.db.models import IdempotencyKey, RefreshToken
from app.db.repos.entity_repo import utc_now


def get_refresh_token_by_hash(session: Session, token_hash: str) -> RefreshToken | None:
    return session.exec(select(RefreshToken).where(RefreshToken.token_hash == token_hash)).first()


def revoke_refresh_token(
    session: Session, token: RefreshToken, *, replaced_by_token_id: str | None = None
) -> RefreshToken:
    token.revoked_at = utc_now()
    token.replaced_by_token_id = replaced_by_token_id
    session.add(token)
    session.flush()
    return token


def get_idempotency_key(session: Session, *, endpoint: str, key: str) -> IdempotencyKey | None:
    return session.exec(
        select(IdempotencyKey)
        .where(IdempotencyKey.endpoint == endpoint)
        .where(IdempotencyKey.key == key)
    ).first()


def create_idempotency_key(
    session: Session,
    *,
    endpoint: str,
    key: str,
    request_hash: str,
    status_code: int,
    response_json: str,
) -> IdempotencyKey:
    record = IdempotencyKey(
        endpoint=endpoint,
        key=key,
        request_hash=request_hash,
        status_code=status_code,
        response_json=response_json,
    )
    session.add(record)
    session.flush()
    return record


def revoke_all_refresh_tokens_for_user(session: Session, user_id: int) -> int:
    tokens = list(
        session.exec(
            select(RefreshToken)
            .where(RefreshToken.user_id == user_id)
            .where(RefreshToken.revoked_at.is_(None))
        )
    )
    now = utc_now()
    for token in tokens:
        token.revoked_at = now
        session.add(token)
    session.flush()
    return len(tokens)


def create_refresh_token_record(
    session: Session,
    *,
    user_id: int,
    token_hash: str,
    jti: str,
    expires_at: datetime,
) -> RefreshToken:
    token = RefreshToken(
        user_id=user_id,
        token_hash=token_hash,
        jti=jti,
        expires_at=expires_at,
    )
    session.add(token)
    session.flush()
    return token
