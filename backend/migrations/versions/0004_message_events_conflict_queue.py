"""message events and conflict queue

Revision ID: 0004_msg_conflict_queue
Revises: 0003_sync_event_resolution
Create Date: 2026-03-28 22:25:00
"""

from alembic import op
import sqlalchemy as sa


revision = "0004_msg_conflict_queue"
down_revision = "0003_sync_event_resolution"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "message_events",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("conversation_id", sa.String(length=64), nullable=False),
        sa.Column("sender_id", sa.String(length=64), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("server_revision", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    op.create_index("ix_message_events_conversation_id", "message_events", ["conversation_id"], unique=False)
    op.create_index("ix_message_events_sender_id", "message_events", ["sender_id"], unique=False)

    op.create_table(
        "conflict_queue",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("operation_id", sa.String(length=128), nullable=False),
        sa.Column("entity_type", sa.String(length=64), nullable=False),
        sa.Column("entity_id", sa.String(length=64), nullable=False),
        sa.Column("conflict_type", sa.String(length=64), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("requires_user_action", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("resolved", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_conflict_queue_operation_id", "conflict_queue", ["operation_id"], unique=True)
    op.create_index("ix_conflict_queue_entity_type", "conflict_queue", ["entity_type"], unique=False)
    op.create_index("ix_conflict_queue_entity_id", "conflict_queue", ["entity_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_conflict_queue_entity_id", table_name="conflict_queue")
    op.drop_index("ix_conflict_queue_entity_type", table_name="conflict_queue")
    op.drop_index("ix_conflict_queue_operation_id", table_name="conflict_queue")
    op.drop_table("conflict_queue")
    op.drop_index("ix_message_events_sender_id", table_name="message_events")
    op.drop_index("ix_message_events_conversation_id", table_name="message_events")
    op.drop_table("message_events")
