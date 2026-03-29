from __future__ import annotations

from sqlalchemy import text

from app.core.config import settings
from app.db.database import engine

try:
    from redis import Redis
except Exception:  # noqa: BLE001
    Redis = None  # type: ignore[assignment]


def database_ready() -> tuple[bool, str]:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True, "ok"
    except Exception:  # noqa: BLE001
        return False, "unreachable"


def redis_ready() -> tuple[bool, str]:
    if not settings.redis_url:
        return True, "not_configured"
    if Redis is None:
        return False, "redis_client_missing"
    try:
        client = Redis.from_url(settings.redis_url, decode_responses=True)
        ok = bool(client.ping())
        return (ok, "ok" if ok else "unreachable")
    except Exception:  # noqa: BLE001
        return False, "unreachable"
