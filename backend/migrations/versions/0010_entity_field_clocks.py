"""add entity field clocks for CRDT merges

Revision ID: 0010_entity_field_clocks
Revises: 0009_device_sync_state
Create Date: 2026-03-29 23:05:00
"""

from alembic import op
import sqlalchemy as sa


revision = "0010_entity_field_clocks"
down_revision = "0009_device_sync_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "entity_field_clocks" in inspector.get_table_names():
        return

    op.create_table(
        "entity_field_clocks",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("entity_type", sa.String(length=64), nullable=False),
        sa.Column("entity_id", sa.String(length=64), nullable=False),
        sa.Column("field_name", sa.String(length=64), nullable=False),
        sa.Column("lamport_counter", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("device_id", sa.String(length=128), nullable=False, server_default=sa.text("''")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("entity_type", "entity_id", "field_name", name="uq_entity_field_clocks_entity_field"),
        sa.CheckConstraint("lamport_counter >= 0", name="ck_entity_field_clocks_lamport_non_negative"),
    )
    op.create_index("ix_entity_field_clocks_entity_type", "entity_field_clocks", ["entity_type"])
    op.create_index("ix_entity_field_clocks_entity_id", "entity_field_clocks", ["entity_id"])
    op.create_index("ix_entity_field_clocks_field_name", "entity_field_clocks", ["field_name"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "entity_field_clocks" not in inspector.get_table_names():
        return

    op.drop_index("ix_entity_field_clocks_field_name", table_name="entity_field_clocks")
    op.drop_index("ix_entity_field_clocks_entity_id", table_name="entity_field_clocks")
    op.drop_index("ix_entity_field_clocks_entity_type", table_name="entity_field_clocks")
    op.drop_table("entity_field_clocks")
