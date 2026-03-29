"""add idempotency keys table

Revision ID: 0007_idempotency_keys
Revises: 0006_refresh_tokens
Create Date: 2026-03-29 18:30:00
"""

from alembic import op
import sqlalchemy as sa


revision = "0007_idempotency_keys"
down_revision = "0006_refresh_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "idempotency_keys",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("endpoint", sa.String(length=128), nullable=False),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("request_hash", sa.String(length=128), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("response_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_idempotency_keys_endpoint", "idempotency_keys", ["endpoint"], unique=False)
    op.create_index("ix_idempotency_keys_key", "idempotency_keys", ["key"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_idempotency_keys_key", table_name="idempotency_keys")
    op.drop_index("ix_idempotency_keys_endpoint", table_name="idempotency_keys")
    op.drop_table("idempotency_keys")
