"""initial schema

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-03-28 18:10:00
"""

from alembic import op
import sqlalchemy as sa


revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "clients",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("client_code", sa.String(length=64), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("phone", sa.String(length=64), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("preferred_language", sa.String(length=16), nullable=False, server_default=sa.text("'en'")),
        sa.Column("city", sa.String(length=120), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("server_revision", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_clients_client_code", "clients", ["client_code"], unique=True)

    op.create_table(
        "inventory_items",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("sku", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("category", sa.String(length=120), nullable=False),
        sa.Column("quantity_on_hand", sa.Numeric(14, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("reorder_level", sa.Numeric(14, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("unit_cost_minor", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("sale_price_minor", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("batch_number", sa.String(length=128), nullable=True),
        sa.Column("expires_on", sa.DateTime(timezone=True), nullable=True),
        sa.Column("server_revision", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_inventory_items_sku", "inventory_items", ["sku"], unique=True)

    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=64), nullable=False, server_default=sa.text("'admin'")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("server_revision", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "invoices",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("invoice_number", sa.String(length=64), nullable=False),
        sa.Column("client_id", sa.String(length=64), sa.ForeignKey("clients.id"), nullable=True),
        sa.Column("currency_code", sa.String(length=8), nullable=False, server_default=sa.text("'SSP'")),
        sa.Column("total_minor", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("balance_due_minor", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("payment_method", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default=sa.text("'ISSUED'")),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("server_revision", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_invoices_invoice_number", "invoices", ["invoice_number"], unique=True)

    op.create_table(
        "invoice_line_items",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("invoice_id", sa.String(length=64), sa.ForeignKey("invoices.id"), nullable=False),
        sa.Column("inventory_item_id", sa.String(length=64), sa.ForeignKey("inventory_items.id"), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 2), nullable=False),
        sa.Column("unit_price_minor", sa.Integer(), nullable=False),
        sa.Column("line_total_minor", sa.Integer(), nullable=False),
        sa.Column("server_revision", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_invoice_line_items_invoice_id", "invoice_line_items", ["invoice_id"], unique=False)
    op.create_index("ix_invoice_line_items_inventory_item_id", "invoice_line_items", ["inventory_item_id"], unique=False)

    op.create_table(
        "appointments",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("client_id", sa.String(length=64), sa.ForeignKey("clients.id"), nullable=False),
        sa.Column("service_type", sa.String(length=255), nullable=False),
        sa.Column("staff_name", sa.String(length=255), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default=sa.text("'PENDING'")),
        sa.Column("reminder_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("server_revision", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_appointments_staff_name", "appointments", ["staff_name"], unique=False)

    op.create_table(
        "messages",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("client_id", sa.String(length=64), sa.ForeignKey("clients.id"), nullable=True),
        sa.Column("channel", sa.String(length=32), nullable=False, server_default=sa.text("'SMS'")),
        sa.Column("direction", sa.String(length=32), nullable=False),
        sa.Column("recipient", sa.String(length=255), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("delivery_status", sa.String(length=32), nullable=False, server_default=sa.text("'queued'")),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("server_revision", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "sync_events",
        sa.Column("server_revision", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("entity", sa.String(length=64), nullable=False),
        sa.Column("operation", sa.String(length=32), nullable=False),
        sa.Column("entity_id", sa.String(length=64), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("operation_id", sa.String(length=128), nullable=False),
        sa.Column("device_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_sync_events_entity_id", "sync_events", ["entity_id"], unique=False)
    op.create_index("ix_sync_events_operation_id", "sync_events", ["operation_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_sync_events_operation_id", table_name="sync_events")
    op.drop_index("ix_sync_events_entity_id", table_name="sync_events")
    op.drop_table("sync_events")
    op.drop_table("messages")
    op.drop_index("ix_appointments_staff_name", table_name="appointments")
    op.drop_table("appointments")
    op.drop_index("ix_invoice_line_items_inventory_item_id", table_name="invoice_line_items")
    op.drop_index("ix_invoice_line_items_invoice_id", table_name="invoice_line_items")
    op.drop_table("invoice_line_items")
    op.drop_index("ix_invoices_invoice_number", table_name="invoices")
    op.drop_table("invoices")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
    op.drop_index("ix_inventory_items_sku", table_name="inventory_items")
    op.drop_table("inventory_items")
    op.drop_index("ix_clients_client_code", table_name="clients")
    op.drop_table("clients")
