from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func
from sqlmodel import Session, select

from app.db.models import InventoryItem, Invoice, InvoiceLineItem


def _parse_date_input(raw_value: str | None, field_name: str) -> date:
    if not raw_value:
        raise ValueError(f"Missing required query parameter: {field_name}.")
    try:
        return date.fromisoformat(raw_value)
    except ValueError as exc:
        raise ValueError(f"Invalid {field_name}; expected YYYY-MM-DD.") from exc


def _date_bounds_utc(from_date: date, to_date: date) -> tuple[datetime, datetime]:
    if to_date < from_date:
        raise ValueError("to must be greater than or equal to from.")
    start = datetime.combine(from_date, time.min, tzinfo=UTC)
    end = datetime.combine(to_date + timedelta(days=1), time.min, tzinfo=UTC)
    return start, end


def analytics_daily_sales(
    session: Session,
    from_raw: str,
    to_raw: str,
    tenant_id: str | None = None,
) -> list[dict[str, Any]]:
    from_date = _parse_date_input(from_raw, "from")
    to_date = _parse_date_input(to_raw, "to")
    start, end = _date_bounds_utc(from_date, to_date)

    stmt = (
        select(
            func.date(Invoice.issued_at).label("sale_date"),
            func.coalesce(func.sum(InvoiceLineItem.line_total_minor), 0).label("total_minor"),
        )
        .join(InvoiceLineItem, InvoiceLineItem.invoice_id == Invoice.id)
        .where(Invoice.deleted_at.is_(None))
        .where(InvoiceLineItem.deleted_at.is_(None))
        .where(Invoice.tenant_id == tenant_id if tenant_id else True)
        .where(InvoiceLineItem.tenant_id == tenant_id if tenant_id else True)
        .where(Invoice.issued_at.is_not(None))
        .where(Invoice.issued_at >= start)
        .where(Invoice.issued_at < end)
        .group_by(func.date(Invoice.issued_at))
        .order_by(func.date(Invoice.issued_at))
    )
    rows = session.exec(stmt).all()
    return [{"date": str(row.sale_date), "total_minor": int(row.total_minor)} for row in rows]


def analytics_top_medicines(
    session: Session,
    from_raw: str,
    to_raw: str,
    limit: int = 10,
    tenant_id: str | None = None,
) -> list[dict[str, Any]]:
    from_date = _parse_date_input(from_raw, "from")
    to_date = _parse_date_input(to_raw, "to")
    start, end = _date_bounds_utc(from_date, to_date)
    bounded_limit = min(max(int(limit or 10), 1), 100)

    stmt = (
        select(
            InventoryItem.id.label("inventory_item_id"),
            InventoryItem.sku.label("sku"),
            InventoryItem.name.label("name"),
            func.coalesce(func.sum(InvoiceLineItem.quantity), 0).label("quantity_sold"),
            func.coalesce(func.sum(InvoiceLineItem.line_total_minor), 0).label("revenue_minor"),
        )
        .join(InvoiceLineItem, InvoiceLineItem.inventory_item_id == InventoryItem.id)
        .join(Invoice, Invoice.id == InvoiceLineItem.invoice_id)
        .where(Invoice.deleted_at.is_(None))
        .where(InvoiceLineItem.deleted_at.is_(None))
        .where(InventoryItem.deleted_at.is_(None))
        .where(Invoice.tenant_id == tenant_id if tenant_id else True)
        .where(InvoiceLineItem.tenant_id == tenant_id if tenant_id else True)
        .where(InventoryItem.tenant_id == tenant_id if tenant_id else True)
        .where(Invoice.issued_at.is_not(None))
        .where(Invoice.issued_at >= start)
        .where(Invoice.issued_at < end)
        .group_by(InventoryItem.id, InventoryItem.sku, InventoryItem.name)
        .order_by(func.sum(InvoiceLineItem.line_total_minor).desc())
        .limit(bounded_limit)
    )
    rows = session.exec(stmt).all()
    return [
        {
            "inventory_item_id": row.inventory_item_id,
            "sku": row.sku,
            "name": row.name,
            "quantity_sold": str(row.quantity_sold),
            "revenue_minor": int(row.revenue_minor),
        }
        for row in rows
    ]


def analytics_expiry_loss(session: Session, days: int, tenant_id: str | None = None) -> dict[str, Any]:
    bounded_days = min(max(int(days), 1), 365)
    now = datetime.now(UTC)
    window_end = now + timedelta(days=bounded_days)
    stmt = (
        select(InventoryItem)
        .where(InventoryItem.deleted_at.is_(None))
        .where(InventoryItem.tenant_id == tenant_id if tenant_id else True)
        .where(InventoryItem.expires_on.is_not(None))
        .where(InventoryItem.expires_on >= now)
        .where(InventoryItem.expires_on <= window_end)
        .where(InventoryItem.quantity_on_hand > 0)
        .order_by(InventoryItem.expires_on)
    )
    rows = list(session.exec(stmt))
    items: list[dict[str, Any]] = []
    total_loss_minor = 0
    for item in rows:
        quantity = Decimal(str(item.quantity_on_hand))
        estimated_loss_minor = int(quantity * Decimal(item.unit_cost_minor))
        total_loss_minor += estimated_loss_minor
        items.append(
            {
                "inventory_item_id": item.id,
                "sku": item.sku,
                "name": item.name,
                "quantity_on_hand": str(item.quantity_on_hand),
                "unit_cost_minor": item.unit_cost_minor,
                "expires_on": item.expires_on.isoformat() if item.expires_on else None,
                "estimated_loss_minor": estimated_loss_minor,
            }
        )

    return {
        "window_days": bounded_days,
        "total_loss_minor": total_loss_minor,
        "items": items,
    }
