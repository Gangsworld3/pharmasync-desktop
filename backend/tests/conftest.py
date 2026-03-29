from __future__ import annotations

import os
import sys
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
import pytest_asyncio
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy.engine import make_url
from sqlalchemy import text
from sqlmodel import Session


ROOT_DIR = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT_DIR / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

TEST_DATABASE_URL = "postgresql+psycopg://pharma:secure123@localhost:5432/pharmasync_test"
os.environ["PHARMASYNC_DATABASE_URL"] = TEST_DATABASE_URL
os.environ.setdefault("PHARMASYNC_JWT_SECRET", "test-pharmasync-jwt-secret-32-bytes-min")
os.environ.setdefault("PHARMASYNC_DEFAULT_ADMIN_EMAIL", "admin@pharmasync.local")
os.environ.setdefault("PHARMASYNC_DEFAULT_ADMIN_PASSWORD", "Admin123!")


def _psycopg_url(database_url: str) -> str:
    return database_url.replace("+psycopg", "")


def _admin_database_url(database_url: str) -> str:
    url = make_url(database_url)
    return _psycopg_url(url.set(database="postgres").render_as_string(hide_password=False))


def _create_test_database(database_url: str) -> None:
    test_db_name = make_url(database_url).database
    admin_url = _admin_database_url(database_url)
    with psycopg.connect(admin_url, autocommit=True) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM pg_database WHERE datname = %s", (test_db_name,))
            exists = cursor.fetchone()
            if not exists:
                cursor.execute(f'CREATE DATABASE "{test_db_name}"')


def _run_migrations() -> None:
    alembic_config = Config(str(ROOT_DIR / "alembic.ini"))
    alembic_config.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)
    command.upgrade(alembic_config, "head")


@pytest.fixture(scope="session", autouse=True)
def setup_database() -> None:
    _create_test_database(TEST_DATABASE_URL)
    _run_migrations()


@pytest_asyncio.fixture(scope="session")
async def app_instance():
    from app.main import app

    async with app.router.lifespan_context(app):
        yield app


@pytest.fixture()
def db_session():
    from app.db.database import engine
    from app.services.auth_service import ensure_default_admin

    table_names = [
        "invoice_line_items",
        "appointments",
        "conflict_queue",
        "message_events",
        "messages",
        "invoices",
        "inventory_items",
        "clients",
        "sync_events",
        "users",
    ]
    truncate_sql = ", ".join(table_names)

    with Session(engine) as session:
        session.exec(text(f"TRUNCATE TABLE {truncate_sql} RESTART IDENTITY CASCADE"))
        session.exec(text("DELETE FROM server_state"))
        session.exec(text("INSERT INTO server_state (scope, current_revision) VALUES ('global', 0)"))
        session.commit()
        ensure_default_admin(session)

    with Session(engine) as session:
        yield session


@pytest_asyncio.fixture()
async def async_client(app_instance, db_session):
    transport = ASGITransport(app=app_instance)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client


@pytest_asyncio.fixture()
async def auth_headers(async_client):
    response = await async_client.post(
        "/auth/login",
        json={"email": "admin@pharmasync.local", "password": "Admin123!"},
    )
    response.raise_for_status()
    token = response.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def unique_suffix() -> str:
    return uuid4().hex[:12]
