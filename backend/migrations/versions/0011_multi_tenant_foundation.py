"""multi-tenant foundation

Revision ID: 0011_multi_tenant_foundation
Revises: 0010_entity_field_clocks
Create Date: 2026-03-30
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0011_multi_tenant_foundation"
down_revision = "0010_entity_field_clocks"
branch_labels = None
depends_on = None


TENANT_DEFAULT = "default"


def _add_tenant_column(table_name: str) -> None:
    op.execute(
        sa.text(
            f"ALTER TABLE IF EXISTS {table_name} "
            "ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'default'"
        )
    )
    op.execute(
        sa.text(
            f"CREATE INDEX IF NOT EXISTS ix_{table_name}_tenant_id "
            f"ON {table_name} (tenant_id)"
        )
    )


def upgrade() -> None:
    op.execute(
        sa.text(
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

    bind = op.get_bind()
    bind.execute(
        sa.text(
            "INSERT INTO tenants (id, name, is_active) VALUES (:tenant_id, :name, true) "
            "ON CONFLICT (id) DO NOTHING"
        ),
        {"tenant_id": TENANT_DEFAULT, "name": "Default Tenant"},
    )

    for table_name in (
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
    ):
        _add_tenant_column(table_name)


def downgrade() -> None:
    for table_name in (
        "audit_logs",
        "conflict_queue",
        "sync_events",
        "message_events",
        "messages",
        "appointments",
        "invoice_line_items",
        "invoices",
        "inventory_items",
        "clients",
        "users",
    ):
        op.drop_index(f"ix_{table_name}_tenant_id", table_name=table_name)
        op.drop_column(table_name, "tenant_id")

    op.drop_table("tenants")
