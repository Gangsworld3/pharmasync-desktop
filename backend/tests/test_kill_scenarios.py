from __future__ import annotations

import asyncio

import pytest
from sqlmodel import select

from app.db.models import InventoryItem, Invoice


def _body(response):
    return response.json()["data"]


async def _create_inventory(async_client, auth_headers, *, sku: str, quantity_on_hand: int):
    response = await async_client.post(
        "/inventory",
        headers=auth_headers,
        json={
            "sku": sku,
            "name": f"Item {sku}",
            "category": "General",
            "quantity_on_hand": quantity_on_hand,
            "reorder_level": 1,
            "unit_cost_minor": 100,
            "sale_price_minor": 200,
        },
    )
    response.raise_for_status()
    return _body(response)


async def _create_invoice(async_client, auth_headers, *, invoice_number: str, sku: str, idempotency_key: str | None = None):
    headers = dict(auth_headers)
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    return await async_client.post(
        "/invoices",
        headers=headers,
        json={
            "invoice_number": invoice_number,
            "payment_method": "CASH",
            "items": [{"inventory_sku": sku, "quantity": 1}],
        },
    )


@pytest.mark.asyncio
async def test_kill_concurrent_sales_no_oversell(async_client, auth_headers, db_session, unique_suffix):
    sku = f"KILL-STOCK-{unique_suffix}"
    await _create_inventory(async_client, auth_headers, sku=sku, quantity_on_hand=1)

    first, second = await asyncio.gather(
        _create_invoice(async_client, auth_headers, invoice_number=f"KILL-INV-A-{unique_suffix}", sku=sku),
        _create_invoice(async_client, auth_headers, invoice_number=f"KILL-INV-B-{unique_suffix}", sku=sku),
    )

    assert sorted([first.status_code, second.status_code]) == [201, 409]
    item = db_session.exec(select(InventoryItem).where(InventoryItem.sku == sku)).one()
    assert float(item.quantity_on_hand) >= 0
    assert float(item.quantity_on_hand) == 0


@pytest.mark.asyncio
async def test_kill_idempotency_key_race_is_safe(async_client, auth_headers, db_session, unique_suffix):
    sku = f"KILL-IDEMP-{unique_suffix}"
    await _create_inventory(async_client, auth_headers, sku=sku, quantity_on_hand=5)
    key = f"kill-key-{unique_suffix}"
    invoice_number = f"KILL-IDEMP-INV-{unique_suffix}"

    first, second = await asyncio.gather(
        _create_invoice(
            async_client,
            auth_headers,
            invoice_number=invoice_number,
            sku=sku,
            idempotency_key=key,
        ),
        _create_invoice(
            async_client,
            auth_headers,
            invoice_number=invoice_number,
            sku=sku,
            idempotency_key=key,
        ),
    )

    first.raise_for_status()
    second.raise_for_status()
    assert first.json() == second.json()
    count = len(list(db_session.exec(select(Invoice).where(Invoice.invoice_number == invoice_number))))
    assert count == 1
