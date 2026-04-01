import os
from urllib.parse import urlparse

from sqlalchemy import text


def _is_production() -> bool:
    return os.getenv("ENV", "development").strip().lower() == "production"


def _is_strict_mode() -> bool:
    return _is_production() or os.getenv("PHARMASYNC_STRICT_ENV", "0").strip() == "1"


def _require_non_empty(name: str) -> str:
    value = (os.getenv(name) or "").strip()
    if not value:
        raise RuntimeError(f"Missing {name}")
    return value


def _assert_db_url(db_url: str) -> None:
    parsed = urlparse(db_url)
    if parsed.scheme not in {"postgresql", "postgresql+psycopg", "postgres"}:
        raise RuntimeError("Invalid PHARMASYNC_DATABASE_URL scheme")
    if not parsed.hostname:
        raise RuntimeError("Invalid PHARMASYNC_DATABASE_URL host")


def _assert_secret_quality(name: str, value: str, *, min_length: int) -> None:
    lowered = value.lower()
    weak_markers = ("change-me", "your-", "<", "admin123", "dev-insecure", "test-", "password")
    if len(value) < min_length or any(marker in lowered for marker in weak_markers):
        raise RuntimeError(f"Weak {name}. Rotate and set a stronger value.")


def assert_env():
    db_url = _require_non_empty("PHARMASYNC_DATABASE_URL")
    _assert_db_url(db_url)

    if _is_strict_mode():
        if os.getenv("DATABASE_URL"):
            raise RuntimeError(
                "DATABASE_URL is not allowed in strict mode. Use PHARMASYNC_DATABASE_URL only."
            )

        jwt_secret = _require_non_empty("PHARMASYNC_JWT_SECRET")
        admin_password = _require_non_empty("PHARMASYNC_DEFAULT_ADMIN_PASSWORD")
        _assert_secret_quality("PHARMASYNC_JWT_SECRET", jwt_secret, min_length=32)
        _assert_secret_quality("PHARMASYNC_DEFAULT_ADMIN_PASSWORD", admin_password, min_length=12)


def assert_db_connection(engine):
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError("Database not reachable") from exc


def run_startup_checks(engine):
    assert_env()
    assert_db_connection(engine)
