from sqlalchemy import text
from sqlmodel import Session, create_engine

from app.core.config import settings


def _normalize_runtime_database_url(url: str) -> str:
    normalized = url.strip().strip("\"'")
    if normalized.startswith("postgres://"):
        return normalized.replace("postgres://", "postgresql+psycopg://", 1)
    if normalized.startswith("postgresql://"):
        return normalized.replace("postgresql://", "postgresql+psycopg://", 1)
    return normalized


DATABASE_URL = _normalize_runtime_database_url(settings.database_url)

if not DATABASE_URL.startswith("postgresql+psycopg://"):
    raise RuntimeError(
        "Unsafe backend database configuration. FastAPI must use PostgreSQL only. "
        "SQLite is reserved for the desktop application's local store."
    )


engine = create_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
)


def get_session():
    with Session(engine) as session:
        yield session


def init_database() -> None:
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
