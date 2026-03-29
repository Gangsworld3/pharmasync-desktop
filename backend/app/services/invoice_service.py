from __future__ import annotations

import uuid
from dataclasses import dataclass
from decimal import Decimal

from sqlmodel import Session

from app.db.models import InventoryItem, Invoice, InvoiceLineItem
from app.db.repositories import (
    append_sync_event,
    apply_server_revision,
    get_active_by_id,
    get_inventory_by_sku,
    list_invoice_items,
    touch_for_update,
    utc_now,
)


@dataclass
class InvoiceItemInput:
    inventory_sku: str
    quantity: Decimal
    unit_price_minor: int | None = None
    description: str | None = None


def _mark_inventory_for_sale(item: InventoryItem, quantity: Decimal) -> None:
    if item.quantity_on_hand < quantity:
        raise ValueError(f"Insufficient stock for {item.sku}.")
    item.quantity_on_hand = item.quantity_on_hand - quantity
    touch_for_update(item)


def create_invoice(
    session: Session,
    invoice: Invoice,
    items: list[InvoiceItemInput],
    device_id: str | None = None,
    operation_id: str | None = None,
    auto_commit: bool = True,
) -> Invoice:
    if not items:
        raise ValueError("Invoice requires at least one line item.")

    try:
        line_items: list[InvoiceLineItem] = []
        total = 0

        for item_input in items:
            inventory = get_inventory_by_sku(session, item_input.inventory_sku)
            if not inventory:
                raise ValueError(f"Inventory SKU {item_input.inventory_sku} not found.")

            _mark_inventory_for_sale(inventory, item_input.quantity)
            unit_price = item_input.unit_price_minor or inventory.sale_price_minor
            line_total = int(Decimal(unit_price) * item_input.quantity)
            total += line_total
            line_items.append(
                InvoiceLineItem(
                    invoice_id="pending",
                    inventory_item_id=inventory.id,
                    description=item_input.description or inventory.name,
                    quantity=item_input.quantity,
                    unit_price_minor=unit_price,
                    line_total_minor=line_total,
                )
            )
            session.add(inventory)

        invoice.total_minor = total
        invoice.balance_due_minor = total
        invoice.status = invoice.status or "ISSUED"
        invoice.issued_at = utc_now()
        touch_for_update(invoice)
        session.add(invoice)
        session.flush()

        for line_item in line_items:
            line_item.invoice_id = invoice.id
            session.add(line_item)

        invoice_event = append_sync_event(
            session,
            entity="Invoice",
            operation="CREATE",
            entity_id=str(invoice.id),
            payload={
                "invoice_number": invoice.invoice_number,
                "client_id": invoice.client_id,
                "currency_code": invoice.currency_code,
                "total_minor": invoice.total_minor,
                "balance_due_minor": invoice.balance_due_minor,
                "payment_method": invoice.payment_method,
                "status": invoice.status,
            },
            operation_id=operation_id or str(uuid.uuid4()),
            device_id=device_id,
        )
        apply_server_revision(invoice, invoice_event.server_revision or 0)
        session.add(invoice)

        for line_item in line_items:
            inventory_event = append_sync_event(
                session,
                entity="InventoryItem",
                operation="UPDATE",
                entity_id=line_item.inventory_item_id,
                payload={"invoice_id": invoice.id, "quantity": line_item.quantity},
                operation_id=str(uuid.uuid4()),
                device_id=device_id,
            )
            inventory = get_active_by_id(session, InventoryItem, line_item.inventory_item_id)
            if inventory:
                apply_server_revision(inventory, inventory_event.server_revision or 0)
                session.add(inventory)

        if auto_commit:
            session.commit()
            session.refresh(invoice)
        return invoice
    except Exception:
        session.rollback()
        raise


def get_invoice_detail(session: Session, invoice_id: str) -> dict:
    invoice = get_active_by_id(session, Invoice, invoice_id)
    if not invoice:
        raise ValueError("Invoice not found.")
    return {"invoice": invoice, "items": list_invoice_items(session, invoice_id)}
