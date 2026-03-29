from __future__ import annotations

import pytest
from sqlmodel import select

from app.db.models import ConflictQueue


def _body(response):
    return response.json()["data"]


def _sync_payload(
    *,
    device_id: str,
    operation_id: str,
    entity_id: str,
    local_revision: int,
    last_pulled_revision: int,
    data: dict,
):
    return {
        "deviceId": device_id,
        "lastPulledRevision": last_pulled_revision,
        "changes": [
            {
                "operationId": operation_id,
                "entity": "InventoryItem",
                "operation": "UPDATE",
                "entityId": entity_id,
                "localRevision": local_revision,
                "data": data,
            }
        ],
    }


@pytest.mark.asyncio
async def test_inventory_stale_safe_fields_use_crdt_merge(async_client, auth_headers, unique_suffix):
    create_response = await async_client.post(
        "/inventory",
        headers=auth_headers,
        json={
            "sku": f"CRDT-INV-{unique_suffix}",
            "name": "Inventory Base",
            "category": "Antibiotic",
            "quantity_on_hand": 20,
            "reorder_level": 3,
            "unit_cost_minor": 1000,
            "sale_price_minor": 2000,
            "batch_number": "B-1",
        },
    )
    create_response.raise_for_status()
    item = _body(create_response)
    base_revision = item["server_revision"]

    first_update = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id=f"inv-device-a-{unique_suffix}",
            operation_id=f"inv-op-a-{unique_suffix}",
            entity_id=item["id"],
            local_revision=base_revision,
            last_pulled_revision=base_revision,
            data={
                "name": "Inventory Updated Name",
                "_crdt": {"changedFields": ["name"], "fieldClocks": {"name": base_revision + 1}},
            },
        ),
    )
    first_update.raise_for_status()

    stale_safe_update = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id=f"inv-device-b-{unique_suffix}",
            operation_id=f"inv-op-b-{unique_suffix}",
            entity_id=item["id"],
            local_revision=base_revision,
            last_pulled_revision=base_revision,
            data={
                "batch_number": "B-2",
                "_crdt": {"changedFields": ["batch_number"], "fieldClocks": {"batch_number": base_revision + 1}},
            },
        ),
    )
    stale_safe_update.raise_for_status()
    result = _body(stale_safe_update)["results"][0]
    assert result["status"] == "APPLIED"
    assert result["resolution"] == "CRDT_MERGED"

    fetched = await async_client.get(f"/inventory/{item['id']}", headers=auth_headers)
    fetched.raise_for_status()
    latest = _body(fetched)
    assert latest["name"] == "Inventory Updated Name"
    assert latest["batch_number"] == "B-2"


@pytest.mark.asyncio
async def test_inventory_stale_strict_fields_conflict(async_client, auth_headers, db_session, unique_suffix):
    create_response = await async_client.post(
        "/inventory",
        headers=auth_headers,
        json={
            "sku": f"CRDT-STRICT-{unique_suffix}",
            "name": "Strict Base",
            "category": "Analgesic",
            "quantity_on_hand": 15,
            "reorder_level": 2,
            "unit_cost_minor": 500,
            "sale_price_minor": 900,
        },
    )
    create_response.raise_for_status()
    item = _body(create_response)
    base_revision = item["server_revision"]

    update_current = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id=f"strict-device-a-{unique_suffix}",
            operation_id=f"strict-op-a-{unique_suffix}",
            entity_id=item["id"],
            local_revision=base_revision,
            last_pulled_revision=base_revision,
            data={"name": "Strict New Name"},
        ),
    )
    update_current.raise_for_status()

    stale_financial = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id=f"strict-device-b-{unique_suffix}",
            operation_id=f"strict-op-b-{unique_suffix}",
            entity_id=item["id"],
            local_revision=base_revision,
            last_pulled_revision=base_revision,
            data={
                "quantity_on_hand": 10,
                "_crdt": {"changedFields": ["quantity_on_hand"], "fieldClocks": {"quantity_on_hand": base_revision + 1}},
            },
        ),
    )
    stale_financial.raise_for_status()
    result = _body(stale_financial)["results"][0]
    assert result["status"] == "CONFLICT"

    queued = db_session.exec(
        select(ConflictQueue).where(ConflictQueue.operation_id == f"strict-op-b-{unique_suffix}")
    ).first()
    assert queued is not None
    assert queued.conflict_type == "INVENTORY_STRICT_FIELD_CONFLICT"


@pytest.mark.asyncio
async def test_inventory_current_strict_field_update_applies(async_client, auth_headers, unique_suffix):
    create_response = await async_client.post(
        "/inventory",
        headers=auth_headers,
        json={
            "sku": f"CRDT-CURRENT-{unique_suffix}",
            "name": "Current Base",
            "category": "Vitamin",
            "quantity_on_hand": 12,
            "reorder_level": 3,
            "unit_cost_minor": 600,
            "sale_price_minor": 1000,
        },
    )
    create_response.raise_for_status()
    item = _body(create_response)

    update = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id=f"current-device-{unique_suffix}",
            operation_id=f"current-op-{unique_suffix}",
            entity_id=item["id"],
            local_revision=item["server_revision"],
            last_pulled_revision=item["server_revision"],
            data={"quantity_on_hand": 9},
        ),
    )
    update.raise_for_status()
    result = _body(update)["results"][0]
    assert result["status"] == "APPLIED"

    fetched = await async_client.get(f"/inventory/{item['id']}", headers=auth_headers)
    fetched.raise_for_status()
    latest = _body(fetched)
    assert float(latest["quantity_on_hand"]) == 9.0
