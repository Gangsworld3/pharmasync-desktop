import os

from sqlalchemy import text


def assert_env():
    db_url = os.getenv("PHARMASYNC_DATABASE_URL")
    if not db_url:
        raise RuntimeError("Missing PHARMASYNC_DATABASE_URL")


def assert_db_connection(engine):
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError("Database not reachable") from exc


def run_startup_checks(engine):
    assert_env()
    assert_db_connection(engine)
