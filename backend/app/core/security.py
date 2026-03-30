from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt

from app.core.config import settings


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000)
    return f"{salt}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    salt, digest = stored_hash.split("$", 1)
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000).hex()
    return hmac.compare_digest(candidate, digest)


def create_access_token(subject: str, role: str, tenant_id: str = "default") -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": subject,
        "role": role,
        "tenant_id": tenant_id,
        "typ": "access",
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_exp_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_refresh_token(subject: str, role: str, tenant_id: str = "default") -> tuple[str, str, datetime]:
    now = datetime.now(UTC)
    jti = uuid4().hex
    expires_at = now + timedelta(days=settings.refresh_token_exp_days)
    payload = {
        "sub": subject,
        "role": role,
        "tenant_id": tenant_id,
        "jti": jti,
        "typ": "refresh",
        "iat": now,
        "exp": expires_at,
    }
    return (
        jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm),
        jti,
        expires_at,
    )


def decode_token(token: str, *, expected_type: str | None = None) -> dict:
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    token_type = payload.get("typ")
    if expected_type and token_type != expected_type:
        raise ValueError(f"Invalid token type: expected {expected_type}, got {token_type}.")
    return payload


def decode_access_token(token: str) -> dict:
    return decode_token(token, expected_type="access")


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
