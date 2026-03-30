from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Type

from sqlmodel import Session, select

from app.db.models import (
    Appointment,
    Client,
    InventoryItem,
    Invoice,
    InvoiceLineItem,
    MessageEvent,
    User,
)


RESOURCE_MODELS: dict[str, Type[Any]] = {
    "clients": Client,
    "inventory": InventoryItem,
    "appointments": Appointment,
    "messages": MessageEvent,
    "invoices": Invoice,
}

SYNC_ENTITY_MODELS: dict[str, Type[Any]] = {
    "Client": Client,
    "InventoryItem": InventoryItem,
    "Appointment": Appointment,
    "Message": MessageEvent,
    "Invoice": Invoice,
}


def _scope_by_tenant(query: Any, model: Type[Any], tenant_id: str | None) -> Any:
    if tenant_id and hasattr(model, "tenant_id"):
        return query.where(model.tenant_id == tenant_id)
    return query


def utc_now() -> datetime:
    return datetime.now(UTC)


def list_active(session: Session, model: Type[Any], tenant_id: str | None = None) -> list[Any]:
    query = select(model)
    query = _scope_by_tenant(query, model, tenant_id)
    if hasattr(model, "deleted_at"):
        query = query.where(model.deleted_at.is_(None))
    if hasattr(model, "server_revision"):
        query = query.order_by(model.server_revision)
    elif hasattr(model, "created_at"):
        query = query.order_by(model.created_at)
    return list(session.exec(query))


def get_active_by_id(session: Session, model: Type[Any], entity_id: Any, tenant_id: str | None = None) -> Any | None:
    query = select(model).where(model.id == entity_id)
    query = _scope_by_tenant(query, model, tenant_id)
    if hasattr(model, "deleted_at"):
        query = query.where(model.deleted_at.is_(None))
    return session.exec(query).first()


def get_user_by_email(session: Session, email: str, tenant_id: str | None = None) -> User | None:
    query = select(User).where(User.email == email).where(User.deleted_at.is_(None))
    if tenant_id:
        query = query.where(User.tenant_id == tenant_id)
    return session.exec(query).first()


def get_inventory_by_sku(session: Session, sku: str, tenant_id: str | None = None) -> InventoryItem | None:
    query = select(InventoryItem).where(InventoryItem.sku == sku).where(InventoryItem.deleted_at.is_(None))
    if tenant_id:
        query = query.where(InventoryItem.tenant_id == tenant_id)
    return session.exec(query).first()


def get_inventory_by_sku_for_update(session: Session, sku: str, tenant_id: str | None = None) -> InventoryItem | None:
    query = (
        select(InventoryItem)
        .where(InventoryItem.sku == sku)
        .where(InventoryItem.deleted_at.is_(None))
        .with_for_update()
    )
    if tenant_id:
        query = query.where(InventoryItem.tenant_id == tenant_id)
    return session.exec(query).first()


def list_invoice_items(session: Session, invoice_id: str, tenant_id: str | None = None) -> list[InvoiceLineItem]:
    query = (
        select(InvoiceLineItem)
        .where(InvoiceLineItem.invoice_id == invoice_id)
        .where(InvoiceLineItem.deleted_at.is_(None))
    )
    if tenant_id:
        query = query.where(InvoiceLineItem.tenant_id == tenant_id)
    return list(session.exec(query))


def find_appointment_conflict(
    session: Session,
    staff_name: str,
    starts_at: datetime,
    ends_at: datetime,
    exclude_id: str | None = None,
    tenant_id: str | None = None,
) -> Appointment | None:
    query = (
        select(Appointment)
        .where(Appointment.staff_name == staff_name)
        .where(Appointment.deleted_at.is_(None))
        .where(Appointment.status != "CANCELLED")
        .where(Appointment.starts_at < ends_at)
        .where(Appointment.ends_at > starts_at)
    )
    if exclude_id:
        query = query.where(Appointment.id != exclude_id)
    if tenant_id:
        query = query.where(Appointment.tenant_id == tenant_id)
    return session.exec(query).first()


def touch_for_update(entity: Any) -> Any:
    entity.updated_at = utc_now()
    return entity


def mark_deleted(entity: Any) -> Any:
    entity.deleted_at = utc_now()
    entity.updated_at = utc_now()
    return entity


def apply_server_revision(entity: Any, server_revision: int) -> Any:
    entity.server_revision = server_revision
    if hasattr(entity, "updated_at"):
        entity.updated_at = utc_now()
    return entity
