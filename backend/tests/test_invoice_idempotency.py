from __future__ import annotations

import pytest
from sqlmodel import func, select

from app.db.models import Invoice


def _body(response):
    return response.json()["data"]


async def _create_inventory(async_client, auth_headers, *, sku: str, quantity_on_hand: int = 10):
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


async def _invoice_request(async_client, auth_headers, *, invoice_number: str, sku: str, key: str):
    return await async_client.post(
        "/invoices",
        headers={**auth_headers, "Idempotency-Key": key},
        json={
            "invoice_number": invoice_number,
            "payment_method": "CASH",
            "items": [
                {
                    "inventory_sku": sku,
                    "quantity": 1,
                }
            ],
        },
    )


@pytest.mark.asyncio
async def test_invoice_idempotency_replay_returns_cached_response(async_client, auth_headers, db_session, unique_suffix):
    sku = f"IDEMP-{unique_suffix}"
    await _create_inventory(async_client, auth_headers, sku=sku, quantity_on_hand=5)

    key = f"key-{unique_suffix}"
    invoice_number = f"INV-{unique_suffix}"
    first = await _invoice_request(
        async_client,
        auth_headers,
        invoice_number=invoice_number,
        sku=sku,
        key=key,
    )
    first.raise_for_status()

    second = await _invoice_request(
        async_client,
        auth_headers,
        invoice_number=invoice_number,
        sku=sku,
        key=key,
    )
    second.raise_for_status()

    assert first.json() == second.json()
    count = db_session.exec(
        select(func.count()).select_from(Invoice).where(Invoice.invoice_number == invoice_number)
    ).one()
    assert count == 1


@pytest.mark.asyncio
async def test_invoice_idempotency_rejects_key_reuse_with_different_payload(async_client, auth_headers, unique_suffix):
    sku = f"IDEMP2-{unique_suffix}"
    await _create_inventory(async_client, auth_headers, sku=sku, quantity_on_hand=5)

    key = f"key-mismatch-{unique_suffix}"
    first = await _invoice_request(
        async_client,
        auth_headers,
        invoice_number=f"INV-A-{unique_suffix}",
        sku=sku,
        key=key,
    )
    first.raise_for_status()

    second = await _invoice_request(
        async_client,
        auth_headers,
        invoice_number=f"INV-B-{unique_suffix}",
        sku=sku,
        key=key,
    )
    assert second.status_code == 409
    assert second.json()["error"]["message"] == "Idempotency-Key reused with different payload."
