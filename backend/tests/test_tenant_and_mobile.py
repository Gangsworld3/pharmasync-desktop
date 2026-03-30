from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from app.core.security import hash_password
from app.db.models import InventoryItem, Tenant, User


async def _login(async_client, email: str, password: str) -> dict[str, str]:
    response = await async_client.post("/auth/login", json={"email": email, "password": password})
    response.raise_for_status()
    token = response.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_mobile_read_endpoints(async_client, auth_headers, db_session):
    db_session.add(
        InventoryItem(
            tenant_id="default",
            sku="SKU-MOBILE-1",
            name="Mobile Item",
            category="General",
            quantity_on_hand=Decimal("1"),
            reorder_level=Decimal("2"),
            unit_cost_minor=100,
            sale_price_minor=200,
            expires_on=datetime.now(UTC) + timedelta(days=10),
        )
    )
    db_session.commit()

    stock = await async_client.get("/mobile/stock?query=mobile", headers=auth_headers)
    stock.raise_for_status()
    assert stock.json()["status"] == "success"

    expiry = await async_client.get("/mobile/alerts/expiry?days=30", headers=auth_headers)
    expiry.raise_for_status()
    assert expiry.json()["status"] == "success"

    low_stock = await async_client.get("/mobile/alerts/low-stock", headers=auth_headers)
    low_stock.raise_for_status()
    assert low_stock.json()["status"] == "success"


@pytest.mark.asyncio
async def test_tenant_isolation_for_clients_and_sync_pull(async_client, db_session):
    for tenant_id in ("tenant_a", "tenant_b"):
        db_session.add(Tenant(id=tenant_id, name=tenant_id.upper(), is_active=True))
    db_session.add(
        User(
            full_name="Tenant A Pharmacist",
            email="tenant-a@pharmasync.local",
            password_hash=hash_password("TenantA123!"),
            role="pharmacist",
            tenant_id="tenant_a",
            is_active=True,
        )
    )
    db_session.add(
        User(
            full_name="Tenant B Pharmacist",
            email="tenant-b@pharmasync.local",
            password_hash=hash_password("TenantB123!"),
            role="pharmacist",
            tenant_id="tenant_b",
            is_active=True,
        )
    )
    db_session.commit()

    tenant_a_headers = await _login(async_client, "tenant-a@pharmasync.local", "TenantA123!")
    tenant_b_headers = await _login(async_client, "tenant-b@pharmasync.local", "TenantB123!")

    create_client_a = await async_client.post(
        "/clients",
        headers=tenant_a_headers,
        json={
            "client_code": "TENANT-A-CLIENT-1",
            "full_name": "Tenant A Client",
            "preferred_language": "en",
        },
    )
    assert create_client_a.status_code == 201

    list_clients_b = await async_client.get("/clients", headers=tenant_b_headers)
    list_clients_b.raise_for_status()
    assert all(item["client_code"] != "TENANT-A-CLIENT-1" for item in list_clients_b.json()["data"])

    push_a = await async_client.post(
        "/sync/push",
        headers=tenant_a_headers,
        json={
            "deviceId": "tenant-a-device",
            "lastPulledRevision": 0,
            "changes": [
                {
                    "operationId": "tenant-a-op-1",
                    "entity": "Client",
                    "operation": "CREATE",
                    "entityId": "tenant-a-client-sync-1",
                    "localRevision": 0,
                    "data": {
                        "client_code": "TENANT-A-SYNC-CLIENT",
                        "full_name": "Tenant A Sync Client",
                        "preferred_language": "en",
                    },
                }
            ],
        },
    )
    push_a.raise_for_status()

    pull_b = await async_client.get(
        "/sync/pull?since=0&deviceId=tenant-b-device",
        headers=tenant_b_headers,
    )
    pull_b.raise_for_status()
    changes = pull_b.json()["data"]["serverChanges"]
    assert all(change["data"].get("client_code") != "TENANT-A-SYNC-CLIENT" for change in changes)
