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
    op.add_column(
        table_name,
        sa.Column(
            "tenant_id",
            sa.String(length=64),
            nullable=False,
            server_default=TENANT_DEFAULT,
        ),
    )
    op.create_index(f"ix_{table_name}_tenant_id", table_name, ["tenant_id"], unique=False)


def upgrade() -> None:
    op.create_table(
        "tenants",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("id"),
    )

    bind = op.get_bind()
    bind.execute(
        sa.text("INSERT INTO tenants (id, name, is_active) VALUES (:tenant_id, :name, true)"),
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
