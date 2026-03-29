"""sync revision state

Revision ID: 0002_sync_revision_state
Revises: 0001_initial_schema
Create Date: 2026-03-28 20:15:00
"""

from alembic import op
import sqlalchemy as sa


revision = "0002_sync_revision_state"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "server_state",
        sa.Column("scope", sa.String(length=32), primary_key=True),
        sa.Column("current_revision", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.execute(
        """
        INSERT INTO server_state (scope, current_revision)
        SELECT 'global', COALESCE(MAX(server_revision), 0)
        FROM sync_events
        """
    )


def downgrade() -> None:
    op.drop_table("server_state")
