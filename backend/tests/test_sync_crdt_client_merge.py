from __future__ import annotations

import pytest


def _body(response):
    return response.json()["data"]


def _sync_payload(
    *,
    device_id: str,
    operation_id: str,
    operation: str,
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
                "entity": "Client",
                "operation": operation,
                "entityId": entity_id,
                "localRevision": local_revision,
                "data": data,
            }
        ],
    }


@pytest.mark.asyncio
async def test_client_crdt_merges_distinct_fields(async_client, auth_headers, unique_suffix):
    client_id = f"crdt-client-{unique_suffix}"
    create_payload = _sync_payload(
        device_id=f"device-create-{unique_suffix}",
        operation_id=f"crdt-create-{unique_suffix}",
        operation="CREATE",
        entity_id=client_id,
        local_revision=1,
        last_pulled_revision=0,
        data={
            "client_code": f"CRDT-{unique_suffix}",
            "full_name": "Initial Name",
            "preferred_language": "en",
            "city": "Juba",
        },
    )
    created = await async_client.post("/sync/push", headers=auth_headers, json=create_payload)
    created.raise_for_status()
    base_revision = created.json()["meta"]["revision"]

    update_name = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id=f"device-a-{unique_suffix}",
            operation_id=f"crdt-name-{unique_suffix}",
            operation="UPDATE",
            entity_id=client_id,
            local_revision=2,
            last_pulled_revision=base_revision,
            data={
                "full_name": "Updated Name A",
                "_crdt": {
                    "changedFields": ["full_name"],
                    "fieldClocks": {"full_name": 2},
                },
            },
        ),
    )
    update_name.raise_for_status()
    assert _body(update_name)["results"][0]["resolution"] == "CRDT_MERGED"

    update_city = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id=f"device-b-{unique_suffix}",
            operation_id=f"crdt-city-{unique_suffix}",
            operation="UPDATE",
            entity_id=client_id,
            local_revision=2,
            last_pulled_revision=base_revision,
            data={
                "city": "Wau",
                "_crdt": {
                    "changedFields": ["city"],
                    "fieldClocks": {"city": 2},
                },
            },
        ),
    )
    update_city.raise_for_status()
    assert _body(update_city)["results"][0]["resolution"] == "CRDT_MERGED"

    fetched = await async_client.get(f"/clients/{client_id}", headers=auth_headers)
    fetched.raise_for_status()
    client = _body(fetched)
    assert client["full_name"] == "Updated Name A"
    assert client["city"] == "Wau"


@pytest.mark.asyncio
async def test_client_crdt_tiebreak_uses_device_id(async_client, auth_headers, unique_suffix):
    client_id = f"crdt-tie-client-{unique_suffix}"
    create_response = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id=f"device-create-{unique_suffix}",
            operation_id=f"crdt-tie-create-{unique_suffix}",
            operation="CREATE",
            entity_id=client_id,
            local_revision=1,
            last_pulled_revision=0,
            data={
                "client_code": f"CRDT-TIE-{unique_suffix}",
                "full_name": "Initial",
                "preferred_language": "en",
                "city": "Juba",
            },
        ),
    )
    create_response.raise_for_status()
    base_revision = create_response.json()["meta"]["revision"]

    first = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id=f"device-a-{unique_suffix}",
            operation_id=f"crdt-tie-a-{unique_suffix}",
            operation="UPDATE",
            entity_id=client_id,
            local_revision=3,
            last_pulled_revision=base_revision,
            data={
                "full_name": "Name From A",
                "_crdt": {
                    "changedFields": ["full_name"],
                    "fieldClocks": {"full_name": 3},
                },
            },
        ),
    )
    first.raise_for_status()

    second = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id=f"device-z-{unique_suffix}",
            operation_id=f"crdt-tie-z-{unique_suffix}",
            operation="UPDATE",
            entity_id=client_id,
            local_revision=3,
            last_pulled_revision=base_revision,
            data={
                "full_name": "Name From Z",
                "_crdt": {
                    "changedFields": ["full_name"],
                    "fieldClocks": {"full_name": 3},
                },
            },
        ),
    )
    second.raise_for_status()

    fetched = await async_client.get(f"/clients/{client_id}", headers=auth_headers)
    fetched.raise_for_status()
    client = _body(fetched)
    assert client["full_name"] == "Name From Z"


@pytest.mark.asyncio
async def test_client_crdt_accepts_stale_local_revision_with_higher_field_clock(async_client, auth_headers, unique_suffix):
    client_id = f"crdt-stale-client-{unique_suffix}"
    created = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id=f"device-base-{unique_suffix}",
            operation_id=f"crdt-stale-create-{unique_suffix}",
            operation="CREATE",
            entity_id=client_id,
            local_revision=1,
            last_pulled_revision=0,
            data={
                "client_code": f"CRDT-ST-{unique_suffix}",
                "full_name": "Base Name",
                "preferred_language": "en",
                "city": "Juba",
            },
        ),
    )
    created.raise_for_status()
    base_revision = created.json()["meta"]["revision"]

    high_clock_update = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id=f"device-offline-{unique_suffix}",
            operation_id=f"crdt-stale-update-{unique_suffix}",
            operation="UPDATE",
            entity_id=client_id,
            local_revision=1,
            last_pulled_revision=base_revision,
            data={
                "notes": "offline note wins with clock",
                "_crdt": {
                    "changedFields": ["notes"],
                    "fieldClocks": {"notes": 8},
                },
            },
        ),
    )
    high_clock_update.raise_for_status()
    result = _body(high_clock_update)["results"][0]
    assert result["status"] == "APPLIED"
    assert result["resolution"] == "CRDT_MERGED"

    fetched = await async_client.get(f"/clients/{client_id}", headers=auth_headers)
    fetched.raise_for_status()
    assert _body(fetched)["notes"] == "offline note wins with clock"
