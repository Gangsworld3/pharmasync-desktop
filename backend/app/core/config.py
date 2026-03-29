import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

INSECURE_DEV_JWT_SECRET = "dev-insecure-jwt-secret-change-me"
INSECURE_DEV_ADMIN_PASSWORD = "Admin123!"
LOCAL_DEV_DATABASE_URL = "postgresql+psycopg://pharma:secure123@localhost:5432/pharmasync"


def normalize_database_url(url: str) -> str:
    if url.startswith("postgresql+psycopg://"):
        return url
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    return url


def _is_production() -> bool:
    return os.getenv("ENV", "development").strip().lower() == "production"


def _resolve_jwt_secret() -> str:
    secret = os.getenv("PHARMASYNC_JWT_SECRET") or os.getenv("SECRET_KEY")
    if secret:
        return secret
    if _is_production():
        raise RuntimeError(
            "Missing JWT secret in production. Set PHARMASYNC_JWT_SECRET or SECRET_KEY."
        )
    return INSECURE_DEV_JWT_SECRET


def _resolve_admin_password() -> str:
    password = os.getenv("PHARMASYNC_DEFAULT_ADMIN_PASSWORD")
    if password:
        return password
    if _is_production():
        raise RuntimeError(
            "Missing PHARMASYNC_DEFAULT_ADMIN_PASSWORD in production."
        )
    return INSECURE_DEV_ADMIN_PASSWORD


def _resolve_database_url() -> str:
    raw_url = os.getenv("DATABASE_URL") or os.getenv("PHARMASYNC_DATABASE_URL")
    if raw_url:
        return normalize_database_url(raw_url)
    if _is_production():
        raise RuntimeError(
            "Missing DATABASE_URL in production. Set DATABASE_URL (or PHARMASYNC_DATABASE_URL)."
        )
    return LOCAL_DEV_DATABASE_URL


class Settings(BaseSettings):
    app_name: str = "PharmaSync FastAPI"
    env: str = os.getenv("ENV", "development")
    jwt_secret: str = _resolve_jwt_secret()
    jwt_algorithm: str = "HS256"
    access_token_exp_minutes: int = 15
    refresh_token_exp_days: int = 7
    auth_login_limit_per_minute: int = 20
    auth_refresh_limit_per_minute: int = 60
    redis_url: str | None = None
    redis_key_prefix: str = "pharmasync"
    security_alert_webhook_url: str | None = None
    security_alert_timeout_seconds: int = 5
    log_level: str = "INFO"
    default_admin_email: str = "admin@pharmasync.local"
    default_admin_password: str = _resolve_admin_password()
    database_url: str = _resolve_database_url()

    model_config = SettingsConfigDict(
        env_prefix="PHARMASYNC_",
        env_file=str(Path(__file__).resolve().parents[2] / ".env"),
        extra="ignore",
    )


settings = Settings()
