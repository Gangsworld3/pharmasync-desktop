"""add sync event audit hash chain

Revision ID: 0008_sync_event_audit
Revises: 0007_idempotency_keys
Create Date: 2026-03-29 21:30:00
"""

from alembic import op
import sqlalchemy as sa


revision = "0008_sync_event_audit"
down_revision = "0007_idempotency_keys"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sync_event_audit",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("server_revision", sa.BigInteger(), nullable=False),
        sa.Column("operation_id", sa.String(length=128), nullable=False),
        sa.Column("payload_hash", sa.String(length=128), nullable=False),
        sa.Column("previous_event_hash", sa.String(length=128), nullable=True),
        sa.Column("event_hash", sa.String(length=128), nullable=False),
        sa.Column("hash_algorithm", sa.String(length=32), nullable=False, server_default=sa.text("'sha256'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["server_revision"], ["sync_events.server_revision"]),
    )
    op.create_index("ix_sync_event_audit_server_revision", "sync_event_audit", ["server_revision"], unique=True)
    op.create_index("ix_sync_event_audit_operation_id", "sync_event_audit", ["operation_id"], unique=False)
    op.create_index("ix_sync_event_audit_event_hash", "sync_event_audit", ["event_hash"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_sync_event_audit_event_hash", table_name="sync_event_audit")
    op.drop_index("ix_sync_event_audit_operation_id", table_name="sync_event_audit")
    op.drop_index("ix_sync_event_audit_server_revision", table_name="sync_event_audit")
    op.drop_table("sync_event_audit")
