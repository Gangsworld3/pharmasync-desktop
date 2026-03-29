from __future__ import annotations

from decimal import Decimal
from datetime import UTC, datetime
from typing import Optional
from uuid import uuid4

from sqlalchemy import BigInteger, Boolean, Column, DateTime, Integer, Numeric, String, Text, text
from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    return datetime.now(UTC)


class Client(SQLModel, table=True):
    __tablename__ = "clients"

    id: str = Field(default_factory=lambda: uuid4().hex, primary_key=True, max_length=64)
    client_code: str = Field(sa_column=Column(String(64), nullable=False, unique=True, index=True))
    full_name: str = Field(sa_column=Column(String(255), nullable=False))
    phone: Optional[str] = Field(default=None, sa_column=Column(String(64), nullable=True))
    email: Optional[str] = Field(default=None, sa_column=Column(String(255), nullable=True))
    preferred_language: str = Field(default="en", sa_column=Column(String(16), nullable=False, server_default=text("'en'")))
    city: Optional[str] = Field(default=None, sa_column=Column(String(120), nullable=True))
    notes: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    server_revision: int = Field(default=0, sa_column=Column(Integer, nullable=False, server_default=text("0")))
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP")))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP")))
    deleted_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))


class InventoryItem(SQLModel, table=True):
    __tablename__ = "inventory_items"

    id: str = Field(default_factory=lambda: uuid4().hex, primary_key=True, max_length=64)
    sku: str = Field(sa_column=Column(String(64), nullable=False, unique=True, index=True))
    name: str = Field(sa_column=Column(String(255), nullable=False))
    category: str = Field(sa_column=Column(String(120), nullable=False))
    quantity_on_hand: Decimal = Field(default=Decimal("0"), sa_column=Column(Numeric(14, 2), nullable=False, server_default=text("0")))
    reorder_level: Decimal = Field(default=Decimal("0"), sa_column=Column(Numeric(14, 2), nullable=False, server_default=text("0")))
    unit_cost_minor: int = Field(default=0, sa_column=Column(Integer, nullable=False, server_default=text("0")))
    sale_price_minor: int = Field(default=0, sa_column=Column(Integer, nullable=False, server_default=text("0")))
    batch_number: Optional[str] = Field(default=None, sa_column=Column(String(128), nullable=True))
    expires_on: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    server_revision: int = Field(default=0, sa_column=Column(Integer, nullable=False, server_default=text("0")))
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP")))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP")))
    deleted_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))


class Invoice(SQLModel, table=True):
    __tablename__ = "invoices"

    id: str = Field(default_factory=lambda: uuid4().hex, primary_key=True, max_length=64)
    invoice_number: str = Field(sa_column=Column(String(64), nullable=False, unique=True, index=True))
    client_id: Optional[str] = Field(default=None, foreign_key="clients.id")
    currency_code: str = Field(default="SSP", sa_column=Column(String(8), nullable=False, server_default=text("'SSP'")))
    total_minor: int = Field(default=0, sa_column=Column(Integer, nullable=False, server_default=text("0")))
    balance_due_minor: int = Field(default=0, sa_column=Column(Integer, nullable=False, server_default=text("0")))
    payment_method: str = Field(sa_column=Column(String(64), nullable=False))
    status: str = Field(default="ISSUED", sa_column=Column(String(32), nullable=False, server_default=text("'ISSUED'")))
    issued_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    server_revision: int = Field(default=0, sa_column=Column(Integer, nullable=False, server_default=text("0")))
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP")))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP")))
    deleted_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))


class InvoiceLineItem(SQLModel, table=True):
    __tablename__ = "invoice_line_items"

    id: Optional[int] = Field(default=None, sa_column=Column(BigInteger, primary_key=True, autoincrement=True))
    invoice_id: str = Field(foreign_key="invoices.id", index=True)
    inventory_item_id: str = Field(foreign_key="inventory_items.id", index=True)
    description: str = Field(sa_column=Column(String(255), nullable=False))
    quantity: Decimal = Field(sa_column=Column(Numeric(14, 2), nullable=False))
    unit_price_minor: int = Field(sa_column=Column(Integer, nullable=False))
    line_total_minor: int = Field(sa_column=Column(Integer, nullable=False))
    server_revision: int = Field(default=0, sa_column=Column(Integer, nullable=False, server_default=text("0")))
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP")))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP")))
    deleted_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))


class Appointment(SQLModel, table=True):
    __tablename__ = "appointments"

    id: str = Field(default_factory=lambda: uuid4().hex, primary_key=True, max_length=64)
    client_id: str = Field(foreign_key="clients.id")
    service_type: str = Field(sa_column=Column(String(255), nullable=False))
    staff_name: Optional[str] = Field(default=None, sa_column=Column(String(255), nullable=True, index=True))
    starts_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    ends_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    status: str = Field(default="PENDING", sa_column=Column(String(32), nullable=False, server_default=text("'PENDING'")))
    reminder_sent_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    notes: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    server_revision: int = Field(default=0, sa_column=Column(Integer, nullable=False, server_default=text("0")))
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP")))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP")))
    deleted_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))


class Message(SQLModel, table=True):
    __tablename__ = "messages"

    id: str = Field(default_factory=lambda: uuid4().hex, primary_key=True, max_length=64)
    client_id: Optional[str] = Field(default=None, foreign_key="clients.id")
    channel: str = Field(default="SMS", sa_column=Column(String(32), nullable=False, server_default=text("'SMS'")))
    direction: str = Field(sa_column=Column(String(32), nullable=False))
    recipient: Optional[str] = Field(default=None, sa_column=Column(String(255), nullable=True))
    body: str = Field(sa_column=Column(Text, nullable=False))
    delivery_status: str = Field(default="queued", sa_column=Column(String(32), nullable=False, server_default=text("'queued'")))
    sent_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    server_revision: int = Field(default=0, sa_column=Column(Integer, nullable=False, server_default=text("0")))
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP")))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP")))
    deleted_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))


class MessageEvent(SQLModel, table=True):
    __tablename__ = "message_events"

    id: str = Field(default_factory=lambda: uuid4().hex, primary_key=True, max_length=64)
    conversation_id: str = Field(sa_column=Column(String(64), nullable=False, index=True))
    sender_id: str = Field(sa_column=Column(String(64), nullable=False, index=True))
    content: str = Field(sa_column=Column(Text, nullable=False))
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP")))
    server_revision: int = Field(default=0, sa_column=Column(Integer, nullable=False, server_default=text("0")))


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: Optional[int] = Field(default=None, sa_column=Column(BigInteger, primary_key=True, autoincrement=True))
    full_name: str = Field(sa_column=Column(String(255), nullable=False))
    email: str = Field(sa_column=Column(String(255), nullable=False, unique=True, index=True))
    password_hash: str = Field(sa_column=Column(String(255), nullable=False))
    role: str = Field(default="admin", sa_column=Column(String(64), nullable=False, server_default=text("'admin'")))
    is_active: bool = Field(default=True, sa_column=Column(Boolean, nullable=False, server_default=text("true")))
    server_revision: int = Field(default=0, sa_column=Column(Integer, nullable=False, server_default=text("0")))
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP")))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP")))
    deleted_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))


class SyncEvent(SQLModel, table=True):
    __tablename__ = "sync_events"

    server_revision: Optional[int] = Field(default=None, sa_column=Column(BigInteger, primary_key=True, autoincrement=False))
    entity: str = Field(sa_column=Column(String(64), nullable=False))
    operation: str = Field(sa_column=Column(String(32), nullable=False))
    entity_id: str = Field(sa_column=Column(String(64), nullable=False, index=True))
    payload_json: str = Field(sa_column=Column(Text, nullable=False))
    operation_id: str = Field(sa_column=Column(String(128), nullable=False, unique=True, index=True))
    device_id: Optional[str] = Field(default=None, sa_column=Column(String(128), nullable=True))
    resolution_type: Optional[str] = Field(default=None, sa_column=Column(String(64), nullable=True))
    resolved: bool = Field(default=False, sa_column=Column(Boolean, nullable=False, server_default=text("false")))
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP")))


class ServerState(SQLModel, table=True):
    __tablename__ = "server_state"

    scope: str = Field(default="global", sa_column=Column(String(32), primary_key=True))
    current_revision: int = Field(default=0, sa_column=Column(BigInteger, nullable=False, server_default=text("0")))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP")))


class ConflictQueue(SQLModel, table=True):
    __tablename__ = "conflict_queue"

    id: str = Field(default_factory=lambda: uuid4().hex, primary_key=True, max_length=64)
    operation_id: str = Field(sa_column=Column(String(128), nullable=False, unique=True, index=True))
    entity_type: str = Field(sa_column=Column(String(64), nullable=False, index=True))
    entity_id: str = Field(sa_column=Column(String(64), nullable=False, index=True))
    conflict_type: str = Field(sa_column=Column(String(64), nullable=False))
    payload_json: str = Field(sa_column=Column(Text, nullable=False))
    requires_user_action: bool = Field(default=True, sa_column=Column(Boolean, nullable=False, server_default=text("true")))
    resolved: bool = Field(default=False, sa_column=Column(Boolean, nullable=False, server_default=text("false")))
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP")))
