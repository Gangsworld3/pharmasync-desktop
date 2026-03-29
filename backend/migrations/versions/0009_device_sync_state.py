"""add device sync state for monotonic cursor guarantees

Revision ID: 0009_device_sync_state
Revises: 0008_sync_event_audit
Create Date: 2026-03-29 22:10:00
"""

from alembic import op
import sqlalchemy as sa


revision = "0009_device_sync_state"
down_revision = "0008_sync_event_audit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "device_sync_state" in inspector.get_table_names():
        return

    op.create_table(
        "device_sync_state",
        sa.Column("device_id", sa.String(length=128), primary_key=True),
        sa.Column("last_seen_revision", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("last_push_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_pull_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_operation_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "device_sync_state" in inspector.get_table_names():
        op.drop_table("device_sync_state")
