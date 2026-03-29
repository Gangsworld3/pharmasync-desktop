"""add integrity constraints and audit logs

Revision ID: 0005_constraints_audit
Revises: 0004_msg_conflict_queue
Create Date: 2026-03-29 07:10:00
"""

from alembic import op
import sqlalchemy as sa


revision = "0005_constraints_audit"
down_revision = "0004_msg_conflict_queue"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_check_constraint(
        "ck_inventory_items_quantity_on_hand_non_negative",
        "inventory_items",
        "quantity_on_hand >= 0",
    )
    op.create_check_constraint(
        "ck_inventory_items_reorder_level_non_negative",
        "inventory_items",
        "reorder_level >= 0",
    )
    op.create_check_constraint(
        "ck_inventory_items_unit_cost_non_negative",
        "inventory_items",
        "unit_cost_minor >= 0",
    )
    op.create_check_constraint(
        "ck_inventory_items_sale_price_non_negative",
        "inventory_items",
        "sale_price_minor >= 0",
    )

    op.create_check_constraint("ck_invoices_total_non_negative", "invoices", "total_minor >= 0")
    op.create_check_constraint("ck_invoices_balance_due_non_negative", "invoices", "balance_due_minor >= 0")

    op.create_check_constraint("ck_invoice_line_items_quantity_positive", "invoice_line_items", "quantity > 0")
    op.create_check_constraint(
        "ck_invoice_line_items_unit_price_non_negative",
        "invoice_line_items",
        "unit_price_minor >= 0",
    )
    op.create_check_constraint(
        "ck_invoice_line_items_line_total_non_negative",
        "invoice_line_items",
        "line_total_minor >= 0",
    )

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("action", sa.String(length=128), nullable=False),
        sa.Column("table_name", sa.String(length=128), nullable=False),
        sa.Column("record_id", sa.String(length=64), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_audit_logs_action", "audit_logs", ["action"], unique=False)
    op.create_index("ix_audit_logs_table_name", "audit_logs", ["table_name"], unique=False)
    op.create_index("ix_audit_logs_record_id", "audit_logs", ["record_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_audit_logs_record_id", table_name="audit_logs")
    op.drop_index("ix_audit_logs_table_name", table_name="audit_logs")
    op.drop_index("ix_audit_logs_action", table_name="audit_logs")
    op.drop_table("audit_logs")

    op.drop_constraint("ck_invoice_line_items_line_total_non_negative", "invoice_line_items", type_="check")
    op.drop_constraint("ck_invoice_line_items_unit_price_non_negative", "invoice_line_items", type_="check")
    op.drop_constraint("ck_invoice_line_items_quantity_positive", "invoice_line_items", type_="check")
    op.drop_constraint("ck_invoices_balance_due_non_negative", "invoices", type_="check")
    op.drop_constraint("ck_invoices_total_non_negative", "invoices", type_="check")
    op.drop_constraint("ck_inventory_items_sale_price_non_negative", "inventory_items", type_="check")
    op.drop_constraint("ck_inventory_items_unit_cost_non_negative", "inventory_items", type_="check")
    op.drop_constraint("ck_inventory_items_reorder_level_non_negative", "inventory_items", type_="check")
    op.drop_constraint("ck_inventory_items_quantity_on_hand_non_negative", "inventory_items", type_="check")
