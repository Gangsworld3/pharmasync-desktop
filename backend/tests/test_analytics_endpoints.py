from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

import pytest

from app.db.models import InventoryItem, Invoice, InvoiceLineItem


@pytest.mark.asyncio
async def test_analytics_aggregates(async_client, auth_headers, db_session):
    item_a = InventoryItem(
        tenant_id="default",
        sku="SKU-ANA-1",
        name="Ana Item A",
        category="General",
        quantity_on_hand=Decimal("10"),
        reorder_level=Decimal("2"),
        unit_cost_minor=100,
        sale_price_minor=250,
        expires_on=datetime(2026, 4, 10, tzinfo=UTC),
    )
    item_b = InventoryItem(
        tenant_id="default",
        sku="SKU-ANA-2",
        name="Ana Item B",
        category="General",
        quantity_on_hand=Decimal("5"),
        reorder_level=Decimal("1"),
        unit_cost_minor=300,
        sale_price_minor=500,
        expires_on=datetime(2026, 5, 10, tzinfo=UTC),
    )
    db_session.add(item_a)
    db_session.add(item_b)
    db_session.flush()

    inv_1 = Invoice(
        tenant_id="default",
        invoice_number="INV-ANA-1",
        payment_method="CASH",
        currency_code="SSP",
        total_minor=750,
        balance_due_minor=0,
        status="ISSUED",
        issued_at=datetime(2026, 3, 29, 8, 0, tzinfo=UTC),
    )
    inv_2 = Invoice(
        tenant_id="default",
        invoice_number="INV-ANA-2",
        payment_method="CASH",
        currency_code="SSP",
        total_minor=1000,
        balance_due_minor=0,
        status="ISSUED",
        issued_at=datetime(2026, 3, 30, 8, 0, tzinfo=UTC),
    )
    db_session.add(inv_1)
    db_session.add(inv_2)
    db_session.flush()

    db_session.add(
        InvoiceLineItem(
            tenant_id="default",
            invoice_id=inv_1.id,
            inventory_item_id=item_a.id,
            description=item_a.name,
            quantity=Decimal("3"),
            unit_price_minor=250,
            line_total_minor=750,
        )
    )
    db_session.add(
        InvoiceLineItem(
            tenant_id="default",
            invoice_id=inv_2.id,
            inventory_item_id=item_b.id,
            description=item_b.name,
            quantity=Decimal("2"),
            unit_price_minor=500,
            line_total_minor=1000,
        )
    )
    db_session.commit()

    daily_response = await async_client.get(
        "/analytics/daily-sales?from=2026-03-29&to=2026-03-30",
        headers=auth_headers,
    )
    daily_response.raise_for_status()
    daily = daily_response.json()["data"]
    assert len(daily) == 2
    assert daily[0]["total_minor"] == 750
    assert daily[1]["total_minor"] == 1000

    top_response = await async_client.get(
        "/analytics/top-medicines?from=2026-03-29&to=2026-03-30&limit=2",
        headers=auth_headers,
    )
    top_response.raise_for_status()
    top = top_response.json()["data"]
    assert len(top) == 2
    assert top[0]["revenue_minor"] >= top[1]["revenue_minor"]

    expiry_response = await async_client.get("/analytics/expiry-loss?days=90", headers=auth_headers)
    expiry_response.raise_for_status()
    expiry_payload = expiry_response.json()["data"]
    assert expiry_payload["window_days"] == 90
    assert expiry_payload["total_loss_minor"] > 0

