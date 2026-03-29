from __future__ import annotations

import pytest
from sqlmodel import select

from app.db.models import Client, ConflictQueue


def _body(response):
    return response.json()["data"]


def _error_message(response) -> str:
    payload = response.json()
    if "detail" in payload:
        return str(payload["detail"])
    return str(payload.get("error", {}).get("message", ""))


def _sync_payload(*, device_id: str, operation_id: str, entity_id: str, operation: str, local_revision: int, data: dict):
    return {
        "deviceId": device_id,
        "lastPulledRevision": 0,
        "changes": [
            {
                "operationId": operation_id,
                "entity": "Client",
                "operation": operation,
                "entityId": entity_id,
                "localRevision": local_revision,
                "data": data,
            }
        ],
    }


@pytest.mark.asyncio
async def test_device_cursor_regression_rejected_on_push(async_client, auth_headers, unique_suffix):
    device_id = f"device-{unique_suffix}"
    client_id = f"client-{unique_suffix}"

    create_payload = _sync_payload(
        device_id=device_id,
        operation_id=f"op-create-{unique_suffix}",
        entity_id=client_id,
        operation="CREATE",
        local_revision=1,
        data={
            "client_code": f"CONS-{unique_suffix}",
            "full_name": "Consistency Client",
            "preferred_language": "en",
            "city": "Juba",
        },
    )
    create_response = await async_client.post("/sync/push", headers=auth_headers, json=create_payload)
    create_response.raise_for_status()
    revision = create_response.json()["meta"]["revision"]
    assert revision > 0

    stale_payload = {
        "deviceId": device_id,
        "lastPulledRevision": 0,
        "changes": [
            {
                "operationId": f"op-stale-{unique_suffix}",
                "entity": "Client",
                "operation": "UPDATE",
                "entityId": client_id,
                "localRevision": 1,
                "data": {"notes": "stale update"},
            }
        ],
    }
    stale_response = await async_client.post("/sync/push", headers=auth_headers, json=stale_payload)
    assert stale_response.status_code == 422
    assert "Device cursor regression" in _error_message(stale_response)


@pytest.mark.asyncio
async def test_non_client_stale_write_conflicts(async_client, auth_headers, db_session, unique_suffix):
    create_response = await async_client.post(
        "/inventory",
        headers=auth_headers,
        json={
            "sku": f"CONS-SKU-{unique_suffix}",
            "name": "Consistency Item",
            "category": "Antibiotic",
            "quantity_on_hand": 10,
            "reorder_level": 1,
            "unit_cost_minor": 1000,
            "sale_price_minor": 2000,
        },
    )
    create_response.raise_for_status()
    item = _body(create_response)

    payload = {
        "deviceId": f"device-write-{unique_suffix}",
        "lastPulledRevision": item["server_revision"],
        "changes": [
            {
                "operationId": f"op-inv-update-good-{unique_suffix}",
                "entity": "InventoryItem",
                "operation": "UPDATE",
                "entityId": item["id"],
                "localRevision": item["server_revision"],
                "data": {
                    "sku": item["sku"],
                    "name": item["name"],
                    "category": item["category"],
                    "quantity_on_hand": 8,
                    "reorder_level": item["reorder_level"],
                    "unit_cost_minor": item["unit_cost_minor"],
                    "sale_price_minor": item["sale_price_minor"],
                },
            }
        ],
    }
    applied_response = await async_client.post("/sync/push", headers=auth_headers, json=payload)
    applied_response.raise_for_status()
    applied_body = _body(applied_response)
    assert applied_body["results"][0]["status"] == "APPLIED"

    stale_payload = {
        "deviceId": f"device-other-{unique_suffix}",
        "lastPulledRevision": 0,
        "changes": [
            {
                "operationId": f"op-inv-update-stale-{unique_suffix}",
                "entity": "InventoryItem",
                "operation": "UPDATE",
                "entityId": item["id"],
                "localRevision": item["server_revision"],
                "data": {
                    "sku": item["sku"],
                    "name": item["name"],
                    "category": item["category"],
                    "quantity_on_hand": 6,
                    "reorder_level": item["reorder_level"],
                    "unit_cost_minor": item["unit_cost_minor"],
                    "sale_price_minor": item["sale_price_minor"],
                },
            }
        ],
    }
    stale_response = await async_client.post("/sync/push", headers=auth_headers, json=stale_payload)
    stale_response.raise_for_status()
    stale_body = _body(stale_response)
    assert stale_body["results"][0]["status"] == "CONFLICT"
    assert stale_body["conflicts"][0]["type"] == "INVENTORY_STRICT_FIELD_CONFLICT"

    queued = db_session.exec(
        select(ConflictQueue).where(ConflictQueue.operation_id == f"op-inv-update-stale-{unique_suffix}")
    ).first()
    assert queued is not None


@pytest.mark.asyncio
async def test_pull_monotonic_cursor_rejected_when_regressing(async_client, auth_headers, unique_suffix):
    device_id = f"device-pull-{unique_suffix}"
    client_id = f"client-pull-{unique_suffix}"

    create_payload = _sync_payload(
        device_id=device_id,
        operation_id=f"op-pull-create-{unique_suffix}",
        entity_id=client_id,
        operation="CREATE",
        local_revision=1,
        data={
            "client_code": f"PULL-{unique_suffix}",
            "full_name": "Pull Cursor Client",
            "preferred_language": "en",
            "city": "Juba",
        },
    )
    create_response = await async_client.post("/sync/push", headers=auth_headers, json=create_payload)
    create_response.raise_for_status()
    create_revision = create_response.json()["meta"]["revision"]

    first_pull = await async_client.get(f"/sync/pull?since={create_revision}&deviceId={device_id}", headers=auth_headers)
    first_pull.raise_for_status()
    first_revision = first_pull.json()["meta"]["revision"]
    assert first_revision >= create_revision

    regressing_pull = await async_client.get(
        f"/sync/pull?since={max(create_revision - 1, 0)}&deviceId={device_id}",
        headers=auth_headers,
    )
    assert regressing_pull.status_code == 422
    assert "Device cursor regression" in _error_message(regressing_pull)
