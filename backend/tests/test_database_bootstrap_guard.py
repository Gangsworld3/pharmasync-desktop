from __future__ import annotations

from app.db.database import TENANT_TABLES, _ensure_multi_tenant_foundation


class RecordingConnection:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def execute(self, statement):  # pragma: no cover
        self.calls.append(str(statement))


def test_multi_tenant_bootstrap_guard_enforces_table_columns_and_indexes():
    conn = RecordingConnection()
    _ensure_multi_tenant_foundation(conn)

    joined = "\n".join(conn.calls)
    assert "CREATE TABLE IF NOT EXISTS tenants" in joined
    assert "INSERT INTO tenants (id, name, is_active)" in joined

    for table in TENANT_TABLES:
        assert f"ALTER TABLE IF EXISTS {table}" in joined
        assert f"CREATE INDEX IF NOT EXISTS ix_{table}_tenant_id" in joined
