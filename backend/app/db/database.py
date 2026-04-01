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

TENANT_TABLES = (
    "users",
    "clients",
    "inventory_items",
    "invoices",
    "invoice_line_items",
    "appointments",
    "messages",
    "message_events",
    "sync_events",
    "conflict_queue",
    "audit_logs",
)


def get_session():
    with Session(engine) as session:
        yield session


def _ensure_multi_tenant_foundation(connection) -> None:
    connection.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS tenants (
              id VARCHAR(64) PRIMARY KEY,
              name VARCHAR(255) NOT NULL,
              is_active BOOLEAN NOT NULL DEFAULT true,
              created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    connection.execute(
        text(
            "INSERT INTO tenants (id, name, is_active) VALUES ('default', 'Default Tenant', true) "
            "ON CONFLICT (id) DO NOTHING"
        )
    )

    for table in TENANT_TABLES:
        connection.execute(
            text(
                f"ALTER TABLE IF EXISTS {table} "
                "ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'default'"
            )
        )
        connection.execute(
            text(
                f"CREATE INDEX IF NOT EXISTS ix_{table}_tenant_id "
                f"ON {table} (tenant_id)"
            )
        )


def init_database() -> None:
    with engine.connect() as connection:
        _ensure_multi_tenant_foundation(connection)
        connection.execute(text("SELECT 1"))
