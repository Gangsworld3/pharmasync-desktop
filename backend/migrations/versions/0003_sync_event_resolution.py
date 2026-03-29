"""sync event resolution metadata

Revision ID: 0003_sync_event_resolution
Revises: 0002_sync_revision_state
Create Date: 2026-03-28 22:05:00
"""

from alembic import op
import sqlalchemy as sa


revision = "0003_sync_event_resolution"
down_revision = "0002_sync_revision_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sync_events", sa.Column("resolution_type", sa.String(length=64), nullable=True))
    op.add_column("sync_events", sa.Column("resolved", sa.Boolean(), nullable=False, server_default=sa.text("false")))


def downgrade() -> None:
    op.drop_column("sync_events", "resolved")
    op.drop_column("sync_events", "resolution_type")
