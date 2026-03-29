from __future__ import annotations

import json

import pytest
from sqlmodel import select

from app.db.models import ConflictQueue


def _body(response):
    return response.json()["data"]


async def _create_client(async_client, auth_headers, unique_suffix: str) -> str:
    response = await async_client.post(
        "/clients",
        headers=auth_headers,
        json={
            "client_code": f"APPT-{unique_suffix}",
            "full_name": "Appointment Client",
            "preferred_language": "en",
            "city": "Juba",
        },
    )
    response.raise_for_status()
    return _body(response)["id"]


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
                "entity": "Appointment",
                "operation": "UPDATE",
                "entityId": entity_id,
                "localRevision": local_revision,
                "data": data,
            }
        ],
    }


@pytest.mark.asyncio
async def test_appointment_stale_safe_fields_use_crdt_merge(async_client, auth_headers, unique_suffix):
    client_id = await _create_client(async_client, auth_headers, unique_suffix)
    create_response = await async_client.post(
        "/appointments",
        headers=auth_headers,
        json={
            "client_id": client_id,
            "service_type": "Consultation",
            "staff_name": "Dr. One",
            "starts_at": "2026-04-01T09:00:00Z",
            "ends_at": "2026-04-01T09:30:00Z",
            "status": "PENDING",
            "notes": "Initial",
        },
    )
    create_response.raise_for_status()
    appt = _body(create_response)
    base_revision = appt["server_revision"]

    first_update = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id=f"appt-device-a-{unique_suffix}",
            operation_id=f"appt-op-a-{unique_suffix}",
            entity_id=appt["id"],
            local_revision=base_revision,
            last_pulled_revision=base_revision,
            data={
                "status": "CONFIRMED",
                "_crdt": {"changedFields": ["status"], "fieldClocks": {"status": base_revision + 1}},
            },
        ),
    )
    first_update.raise_for_status()

    stale_safe_update = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id=f"appt-device-b-{unique_suffix}",
            operation_id=f"appt-op-b-{unique_suffix}",
            entity_id=appt["id"],
            local_revision=base_revision,
            last_pulled_revision=base_revision,
            data={
                "notes": "Merged Note",
                "_crdt": {"changedFields": ["notes"], "fieldClocks": {"notes": base_revision + 1}},
            },
        ),
    )
    stale_safe_update.raise_for_status()
    result = _body(stale_safe_update)["results"][0]
    assert result["status"] == "APPLIED"
    assert result["resolution"] == "CRDT_MERGED"

    fetched = await async_client.get(f"/appointments/{appt['id']}", headers=auth_headers)
    fetched.raise_for_status()
    latest = _body(fetched)
    assert latest["status"] == "CONFIRMED"
    assert latest["notes"] == "Merged Note"


@pytest.mark.asyncio
async def test_appointment_stale_schedule_fields_conflict(async_client, auth_headers, db_session, unique_suffix):
    client_id = await _create_client(async_client, auth_headers, unique_suffix)
    create_response = await async_client.post(
        "/appointments",
        headers=auth_headers,
        json={
            "client_id": client_id,
            "service_type": "Consultation",
            "staff_name": "Dr. Two",
            "starts_at": "2026-04-01T10:00:00Z",
            "ends_at": "2026-04-01T10:30:00Z",
            "status": "PENDING",
        },
    )
    create_response.raise_for_status()
    appt = _body(create_response)
    base_revision = appt["server_revision"]

    current_update = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id=f"appt-strict-a-{unique_suffix}",
            operation_id=f"appt-strict-op-a-{unique_suffix}",
            entity_id=appt["id"],
            local_revision=base_revision,
            last_pulled_revision=base_revision,
            data={"status": "CONFIRMED"},
        ),
    )
    current_update.raise_for_status()

    stale_schedule = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id=f"appt-strict-b-{unique_suffix}",
            operation_id=f"appt-strict-op-b-{unique_suffix}",
            entity_id=appt["id"],
            local_revision=base_revision,
            last_pulled_revision=base_revision,
            data={
                "starts_at": "2026-04-01T11:00:00Z",
                "_crdt": {"changedFields": ["starts_at"], "fieldClocks": {"starts_at": base_revision + 1}},
            },
        ),
    )
    stale_schedule.raise_for_status()
    result = _body(stale_schedule)["results"][0]
    assert result["status"] == "CONFLICT"

    queued = db_session.exec(
        select(ConflictQueue).where(ConflictQueue.operation_id == f"appt-strict-op-b-{unique_suffix}")
    ).first()
    assert queued is not None
    assert queued.conflict_type == "APPOINTMENT_SCHEDULE_CONFLICT"
    payload = json.loads(queued.payload_json)
    assert payload["suggestedResolution"] == "RESCHEDULE"
    assert isinstance(payload.get("serverSuggestedNextSlots"), list)
    assert len(payload["serverSuggestedNextSlots"]) >= 1
    first_slot = payload["serverSuggestedNextSlots"][0]
    assert "starts_at" in first_slot
    assert "ends_at" in first_slot
    assert first_slot["timezone"] == "Africa/Juba"
    assert "T" in first_slot["starts_at"]
    assert "T" in first_slot["ends_at"]
    assert payload["suggestedDurationMinutes"] > 0
    assert payload["scheduleContext"]["staff_name"] == "Dr. Two"
    assert payload["scheduleContext"]["timezone"] == "Africa/Juba"


@pytest.mark.asyncio
async def test_appointment_current_schedule_update_applies(async_client, auth_headers, unique_suffix):
    client_id = await _create_client(async_client, auth_headers, unique_suffix)
    create_response = await async_client.post(
        "/appointments",
        headers=auth_headers,
        json={
            "client_id": client_id,
            "service_type": "Consultation",
            "staff_name": "Dr. Three",
            "starts_at": "2026-04-01T12:00:00Z",
            "ends_at": "2026-04-01T12:30:00Z",
            "status": "PENDING",
        },
    )
    create_response.raise_for_status()
    appt = _body(create_response)

    update = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id=f"appt-current-{unique_suffix}",
            operation_id=f"appt-current-op-{unique_suffix}",
            entity_id=appt["id"],
            local_revision=appt["server_revision"],
            last_pulled_revision=appt["server_revision"],
            data={"starts_at": "2026-04-01T12:15:00Z", "ends_at": "2026-04-01T12:45:00Z"},
        ),
    )
    update.raise_for_status()
    result = _body(update)["results"][0]
    assert result["status"] == "APPLIED"
