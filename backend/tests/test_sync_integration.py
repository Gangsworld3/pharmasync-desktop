from __future__ import annotations

import asyncio
import random
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlmodel import func, select

from app.db.models import Appointment, Client, ConflictQueue, InventoryItem, Invoice, MessageEvent, SyncEvent


def _body(response):
    return response.json()["data"]


def _meta(response):
    return response.json()["meta"]


def _sync_data(response):
    body = _body(response)
    meta = _meta(response)
    return body, meta


def _inventory_quantity(db_session, sku: str) -> float:
    item = db_session.exec(select(InventoryItem).where(InventoryItem.sku == sku)).one()
    return float(item.quantity_on_hand)


def _invoice_exists(db_session, invoice_number: str) -> bool:
    statement = select(func.count()).select_from(Invoice).where(Invoice.invoice_number == invoice_number)
    return bool(db_session.exec(statement).one())


def _assert_revision_integrity(db_session) -> None:
    event_count = db_session.exec(select(func.count()).select_from(SyncEvent)).one()
    max_revision = db_session.exec(select(func.max(SyncEvent.server_revision))).one()
    assert event_count == (max_revision or 0)


def _assert_no_negative_inventory(db_session) -> None:
    quantities = db_session.exec(select(InventoryItem.quantity_on_hand)).all()
    assert all(Decimal(quantity) >= 0 for quantity in quantities)


def _assert_no_duplicate_operations(db_session) -> None:
    duplicates = db_session.exec(
        select(SyncEvent.operation_id, func.count())
        .group_by(SyncEvent.operation_id)
        .having(func.count() > 1)
    ).all()
    assert duplicates == []


def _sync_payload(*, device_id: str, operation_id: str, entity: str, operation: str, entity_id: str, local_revision: int, data: dict):
    return {
        "deviceId": device_id,
        "lastPulledRevision": 0,
        "changes": [
            {
                "operationId": operation_id,
                "entity": entity,
                "operation": operation,
                "entityId": entity_id,
                "localRevision": local_revision,
                "data": data,
            }
        ],
    }


async def _create_inventory(async_client, auth_headers, *, sku: str, quantity_on_hand: int, sale_price_minor: int = 2000):
    response = await async_client.post(
        "/inventory",
        headers=auth_headers,
        json={
            "sku": sku,
            "name": f"Item {sku}",
            "category": "Antibiotic",
            "quantity_on_hand": quantity_on_hand,
            "reorder_level": 1,
            "unit_cost_minor": 1000,
            "sale_price_minor": sale_price_minor,
        },
    )
    response.raise_for_status()
    return _body(response)


async def _create_client(async_client, auth_headers, *, client_code: str, full_name: str = "Client Test"):
    response = await async_client.post(
        "/clients",
        headers=auth_headers,
        json={
            "client_code": client_code,
            "full_name": full_name,
            "preferred_language": "en",
            "city": "Juba",
        },
    )
    response.raise_for_status()
    return _body(response)


async def _create_message(async_client, auth_headers, *, conversation_id: str, sender_id: str, content: str):
    response = await async_client.post(
        "/messages",
        headers=auth_headers,
        json={
            "conversation_id": conversation_id,
            "sender_id": sender_id,
            "content": content,
        },
    )
    response.raise_for_status()
    return _body(response)


@pytest.mark.asyncio
async def test_insufficient_stock_rejected(async_client, auth_headers, db_session, unique_suffix):
    sku = f"AMOX-{unique_suffix}"
    invoice_number = f"INV-FAIL-{unique_suffix}"
    await _create_inventory(async_client, auth_headers, sku=sku, quantity_on_hand=3)

    response = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id="DEVICE-A",
            operation_id=f"op-insufficient-{unique_suffix}",
            entity="Invoice",
            operation="CREATE",
            entity_id=f"invoice-insufficient-{unique_suffix}",
            local_revision=1,
            data={
                "invoice_number": invoice_number,
                "payment_method": "CASH",
                "items": [{"sku": sku, "qty": 5}],
            },
        ),
    )
    response.raise_for_status()

    payload = _body(response)
    assert payload["conflicts"][0]["type"] == "INSUFFICIENT_STOCK"
    assert payload["results"][0]["status"] == "REJECTED"
    assert _inventory_quantity(db_session, sku) == 3
    assert not _invoice_exists(db_session, invoice_number)


@pytest.mark.asyncio
async def test_inventory_conflict_between_devices(async_client, auth_headers, db_session, unique_suffix):
    sku = f"AMOX-{unique_suffix}"
    await _create_inventory(async_client, auth_headers, sku=sku, quantity_on_hand=10)

    first_sale = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id="DEVICE-A",
            operation_id=f"op-sale-a-{unique_suffix}",
            entity="Invoice",
            operation="CREATE",
            entity_id=f"invoice-a-{unique_suffix}",
            local_revision=1,
            data={
                "invoice_number": f"INV-A-{unique_suffix}",
                "payment_method": "CASH",
                "items": [{"sku": sku, "qty": 5}],
            },
        ),
    )
    first_sale.raise_for_status()

    second_sale = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id="DEVICE-B",
            operation_id=f"op-sale-b-{unique_suffix}",
            entity="Invoice",
            operation="CREATE",
            entity_id=f"invoice-b-{unique_suffix}",
            local_revision=0,
            data={
                "invoice_number": f"INV-B-{unique_suffix}",
                "payment_method": "CASH",
                "items": [{"sku": sku, "qty": 6}],
            },
        ),
    )
    second_sale.raise_for_status()

    payload = _body(second_sale)
    assert payload["results"][0]["status"] == "REJECTED"
    assert payload["conflicts"][0]["type"] == "INSUFFICIENT_STOCK"
    assert _inventory_quantity(db_session, sku) == 5


@pytest.mark.asyncio
async def test_client_conflict_auto_merges(async_client, auth_headers, db_session, unique_suffix):
    client = await _create_client(async_client, auth_headers, client_code=f"MERGE-{unique_suffix}")

    server_update = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id="DEVICE-A",
            operation_id=f"op-merge-server-{unique_suffix}",
            entity="Client",
            operation="UPDATE",
            entity_id=client["id"],
            local_revision=client["server_revision"],
            data={
                "client_code": client["client_code"],
                "full_name": "Server Updated Name",
                "preferred_language": "en",
                "city": "Juba",
            },
        ),
    )
    server_update.raise_for_status()
    new_revision = _body(server_update)["applied"][0]["serverRevision"]

    merge_response = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id="DEVICE-B",
            operation_id=f"op-merge-client-{unique_suffix}",
            entity="Client",
            operation="UPDATE",
            entity_id=client["id"],
            local_revision=client["server_revision"],
            data={
                "phone": "+211900000001",
                "notes": "merged offline note",
            },
        ),
    )
    merge_response.raise_for_status()
    body = _body(merge_response)

    assert body["results"][0]["status"] == "APPLIED"
    assert body["results"][0]["resolution"] == "AUTO_MERGED"
    assert body["conflicts"][0]["type"] == "CLIENT_MERGE"
    assert body["conflicts"][0]["resolution"] == "AUTO_MERGED"
    assert body["applied"][0]["serverRevision"] > new_revision

    merged_client = db_session.exec(select(Client).where(Client.id == client["id"])).one()
    assert merged_client.full_name == "Server Updated Name"
    assert merged_client.phone == "+211900000001"
    assert merged_client.notes == "merged offline note"


@pytest.mark.asyncio
async def test_message_events_are_append_only_and_ordered(async_client, auth_headers, db_session, unique_suffix):
    conversation_id = f"conv-{unique_suffix}"
    first = await _create_message(
        async_client,
        auth_headers,
        conversation_id=conversation_id,
        sender_id="user-a",
        content="First message",
    )
    second = await _create_message(
        async_client,
        auth_headers,
        conversation_id=conversation_id,
        sender_id="user-b",
        content="Second message",
    )

    list_response = await async_client.get("/messages", headers=auth_headers)
    list_response.raise_for_status()
    messages = [message for message in _body(list_response) if message["conversation_id"] == conversation_id]

    assert len(messages) == 2
    revisions = [message["server_revision"] for message in messages]
    assert revisions == sorted(revisions)
    assert [message["content"] for message in messages] == ["First message", "Second message"]

    replay_payload = _sync_payload(
        device_id="DEVICE-A",
        operation_id=f"op-message-replay-{unique_suffix}",
        entity="Message",
        operation="CREATE",
        entity_id=f"msg-event-{unique_suffix}",
        local_revision=1,
        data={
            "conversation_id": conversation_id,
            "sender_id": "user-a",
            "content": "Replay-safe message",
        },
    )
    first_push = await async_client.post("/sync/push", headers=auth_headers, json=replay_payload)
    second_push = await async_client.post("/sync/push", headers=auth_headers, json=replay_payload)
    first_push.raise_for_status()
    second_push.raise_for_status()

    assert _body(second_push)["results"][0]["status"] == "IDEMPOTENT_REPLAY"
    count = db_session.exec(
        select(func.count()).select_from(MessageEvent).where(MessageEvent.id == f"msg-event-{unique_suffix}")
    ).one()
    assert count == 1


@pytest.mark.asyncio
async def test_soft_delete_propagates(async_client, auth_headers, db_session, unique_suffix):
    client = await _create_client(async_client, auth_headers, client_code=f"CLIENT-{unique_suffix}")

    delete_response = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id="DEVICE-A",
            operation_id=f"op-delete-{unique_suffix}",
            entity="Client",
            operation="DELETE",
            entity_id=client["id"],
            local_revision=client["server_revision"],
            data={},
        ),
    )
    delete_response.raise_for_status()
    assert _body(delete_response)["results"][0]["status"] == "APPLIED"

    pull_response = await async_client.get("/sync/pull?since=0", headers=auth_headers)
    pull_response.raise_for_status()
    changes = _body(pull_response)["serverChanges"]

    delete_change = next(change for change in changes if change["entity"] == "Client" and change["operation"] == "DELETE")
    assert delete_change["entityId"] == client["id"]
    assert delete_change["data"]["deleted_at"]

    deleted_client = db_session.exec(select(Client).where(Client.id == client["id"])).one()
    assert deleted_client.deleted_at is not None


@pytest.mark.asyncio
async def test_idempotent_replay(async_client, auth_headers, db_session, unique_suffix):
    payload = _sync_payload(
        device_id="DEVICE-A",
        operation_id=f"op-replay-{unique_suffix}",
        entity="Client",
        operation="CREATE",
        entity_id=f"client-replay-{unique_suffix}",
        local_revision=1,
        data={
            "client_code": f"REPLAY-{unique_suffix}",
            "full_name": "Replay Client",
            "preferred_language": "en",
            "city": "Juba",
        },
    )

    first_response = await async_client.post("/sync/push", headers=auth_headers, json=payload)
    second_response = await async_client.post("/sync/push", headers=auth_headers, json=payload)
    first_response.raise_for_status()
    second_response.raise_for_status()

    assert _body(first_response)["results"][0]["status"] == "APPLIED"
    assert all(result["status"] == "IDEMPOTENT_REPLAY" for result in _body(second_response)["results"])

    event_count = db_session.exec(
        select(func.count()).select_from(SyncEvent).where(SyncEvent.operation_id == f"op-replay-{unique_suffix}")
    ).one()
    assert event_count == 1


@pytest.mark.asyncio
async def test_appointment_overlap(async_client, auth_headers, db_session, unique_suffix):
    client = await _create_client(async_client, auth_headers, client_code=f"APPT-{unique_suffix}")

    first_booking = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id="DEVICE-A",
            operation_id=f"op-appt-a-{unique_suffix}",
            entity="Appointment",
            operation="CREATE",
            entity_id=f"appointment-a-{unique_suffix}",
            local_revision=1,
            data={
                "client_id": client["id"],
                "service_type": "Consultation",
                "staff_name": "Dr. Lemi",
                "starts_at": "2026-03-29T08:00:00Z",
                "ends_at": "2026-03-29T09:00:00Z",
                "status": "PENDING",
            },
        ),
    )
    first_booking.raise_for_status()

    overlap_booking = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id="DEVICE-B",
            operation_id=f"op-appt-b-{unique_suffix}",
            entity="Appointment",
            operation="CREATE",
            entity_id=f"appointment-b-{unique_suffix}",
            local_revision=1,
            data={
                "client_id": client["id"],
                "service_type": "Consultation",
                "staff_name": "Dr. Lemi",
                "starts_at": "2026-03-29T08:30:00Z",
                "ends_at": "2026-03-29T09:30:00Z",
                "status": "PENDING",
            },
        ),
    )
    overlap_booking.raise_for_status()

    payload = _body(overlap_booking)
    assert payload["results"][0]["status"] == "CONFLICT"
    assert payload["results"][0]["resolution"] == "REQUIRES_USER_ACTION"
    assert payload["conflicts"][0]["type"] == "APPOINTMENT_OVERLAP"
    assert payload["conflicts"][0]["resolution"] == "REQUIRES_USER_ACTION"
    assert len(payload["conflicts"][0]["suggestions"]) >= 1

    queued = db_session.exec(
        select(ConflictQueue).where(ConflictQueue.operation_id == f"op-appt-b-{unique_suffix}")
    ).one()
    assert queued.conflict_type == "APPOINTMENT_OVERLAP"
    assert queued.requires_user_action is True
    assert queued.resolved is False

    appointment_count = db_session.exec(select(func.count()).select_from(Appointment)).one()
    assert appointment_count == 1


@pytest.mark.asyncio
async def test_mixed_batch_apply_merge_and_reject(async_client, auth_headers, db_session, unique_suffix):
    inventory = await _create_inventory(async_client, auth_headers, sku=f"MIX-{unique_suffix}", quantity_on_hand=1)
    client = await _create_client(async_client, auth_headers, client_code=f"MIX-CLIENT-{unique_suffix}")

    baseline_update = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id="DEVICE-A",
            operation_id=f"op-mix-server-{unique_suffix}",
            entity="Client",
            operation="UPDATE",
            entity_id=client["id"],
            local_revision=client["server_revision"],
            data={
                "client_code": client["client_code"],
                "full_name": "Server Mix Name",
                "preferred_language": "en",
                "city": "Juba",
            },
        ),
    )
    baseline_update.raise_for_status()

    payload = {
        "deviceId": "DEVICE-B",
        "lastPulledRevision": 0,
        "changes": [
            {
                "operationId": f"op-mix-create-{unique_suffix}",
                "entity": "Client",
                "operation": "CREATE",
                "entityId": f"mix-create-{unique_suffix}",
                "localRevision": 1,
                "data": {
                    "client_code": f"MIX-CREATE-{unique_suffix}",
                    "full_name": "Batch Applied Client",
                    "preferred_language": "en",
                    "city": "Juba",
                },
            },
            {
                "operationId": f"op-mix-merge-{unique_suffix}",
                "entity": "Client",
                "operation": "UPDATE",
                "entityId": client["id"],
                "localRevision": client["server_revision"],
                "data": {
                    "phone": "+211900000999",
                },
            },
            {
                "operationId": f"op-mix-reject-{unique_suffix}",
                "entity": "Invoice",
                "operation": "CREATE",
                "entityId": f"mix-invoice-{unique_suffix}",
                "localRevision": 1,
                "data": {
                    "invoice_number": f"MIX-INV-{unique_suffix}",
                    "client_id": client["id"],
                    "payment_method": "CASH",
                    "items": [{"sku": inventory["sku"], "qty": 5}],
                },
            },
        ],
    }

    response = await async_client.post("/sync/push", headers=auth_headers, json=payload)
    response.raise_for_status()
    body = _body(response)

    assert [result["status"] for result in body["results"]] == ["APPLIED", "APPLIED", "REJECTED"]
    assert body["results"][1]["resolution"] == "AUTO_MERGED"
    conflict_types = {conflict["type"] for conflict in body["conflicts"]}
    assert {"CLIENT_MERGE", "INSUFFICIENT_STOCK"}.issubset(conflict_types)


@pytest.mark.asyncio
async def test_multi_operation_batch_reports_per_operation_results(async_client, auth_headers, db_session, unique_suffix):
    sku = f"BATCH-{unique_suffix}"
    inventory = await _create_inventory(async_client, auth_headers, sku=sku, quantity_on_hand=1)

    payload = {
        "deviceId": "DEVICE-A",
        "lastPulledRevision": 0,
        "changes": [
            {
                "operationId": f"op-batch-client-{unique_suffix}",
                "entity": "Client",
                "operation": "CREATE",
                "entityId": f"client-batch-{unique_suffix}",
                "localRevision": 1,
                "data": {
                    "client_code": f"BATCH-CLIENT-{unique_suffix}",
                    "full_name": "Batch Client",
                    "preferred_language": "en",
                    "city": "Juba",
                },
            },
            {
                "operationId": f"op-batch-invoice-{unique_suffix}",
                "entity": "Invoice",
                "operation": "CREATE",
                "entityId": f"invoice-batch-{unique_suffix}",
                "localRevision": 1,
                "data": {
                    "invoice_number": f"INV-BATCH-{unique_suffix}",
                    "payment_method": "CASH",
                    "items": [{"sku": sku, "qty": 5}],
                },
            },
        ],
    }

    response = await async_client.post("/sync/push", headers=auth_headers, json=payload)
    response.raise_for_status()
    data = _body(response)

    assert [result["status"] for result in data["results"]] == ["APPLIED", "REJECTED"]
    assert data["conflicts"][0]["type"] == "INSUFFICIENT_STOCK"
    assert _inventory_quantity(db_session, inventory["sku"]) == 1


@pytest.mark.asyncio
async def test_replay_after_client_merge_is_deterministic(async_client, auth_headers, db_session, unique_suffix):
    client = await _create_client(async_client, auth_headers, client_code=f"REPLAY-MERGE-{unique_suffix}")

    server_update = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id="DEVICE-A",
            operation_id=f"op-replay-merge-server-{unique_suffix}",
            entity="Client",
            operation="UPDATE",
            entity_id=client["id"],
            local_revision=client["server_revision"],
            data={
                "client_code": client["client_code"],
                "full_name": "Replay Merge Server",
                "preferred_language": "en",
                "city": "Juba",
            },
        ),
    )
    server_update.raise_for_status()

    payload = _sync_payload(
        device_id="DEVICE-B",
        operation_id=f"op-replay-merge-client-{unique_suffix}",
        entity="Client",
        operation="UPDATE",
        entity_id=client["id"],
        local_revision=client["server_revision"],
        data={"phone": "+211988887777"},
    )

    first_response = await async_client.post("/sync/push", headers=auth_headers, json=payload)
    second_response = await async_client.post("/sync/push", headers=auth_headers, json=payload)
    first_response.raise_for_status()
    second_response.raise_for_status()

    assert _body(first_response)["results"][0]["resolution"] == "AUTO_MERGED"
    assert _body(second_response)["results"][0]["status"] == "IDEMPOTENT_REPLAY"


@pytest.mark.asyncio
async def test_conflict_queue_replay_and_resolution(async_client, auth_headers, db_session, unique_suffix):
    client = await _create_client(async_client, auth_headers, client_code=f"QUEUE-{unique_suffix}")

    first = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id="DEVICE-A",
            operation_id=f"op-queue-a-{unique_suffix}",
            entity="Appointment",
            operation="CREATE",
            entity_id=f"queue-appt-a-{unique_suffix}",
            local_revision=1,
            data={
                "client_id": client["id"],
                "service_type": "Consultation",
                "staff_name": "Dr. Lemi",
                "starts_at": "2026-03-29T08:00:00Z",
                "ends_at": "2026-03-29T09:00:00Z",
                "status": "PENDING",
            },
        ),
    )
    first.raise_for_status()

    payload = _sync_payload(
        device_id="DEVICE-B",
        operation_id=f"op-queue-b-{unique_suffix}",
        entity="Appointment",
        operation="CREATE",
        entity_id=f"queue-appt-b-{unique_suffix}",
        local_revision=1,
        data={
            "client_id": client["id"],
            "service_type": "Consultation",
            "staff_name": "Dr. Lemi",
            "starts_at": "2026-03-29T08:30:00Z",
            "ends_at": "2026-03-29T09:30:00Z",
            "status": "PENDING",
        },
    )
    conflict_response = await async_client.post("/sync/push", headers=auth_headers, json=payload)
    replay_response = await async_client.post("/sync/push", headers=auth_headers, json=payload)
    conflict_response.raise_for_status()
    replay_response.raise_for_status()

    queue_rows = db_session.exec(
        select(ConflictQueue).where(ConflictQueue.operation_id == f"op-queue-b-{unique_suffix}")
    ).all()
    assert len(queue_rows) == 1
    assert _body(replay_response)["results"][0]["status"] == "CONFLICT"

    conflict_list = await async_client.get("/conflicts?resolved=false", headers=auth_headers)
    conflict_list.raise_for_status()
    conflicts = _body(conflict_list)
    conflict_id = next(conflict["id"] for conflict in conflicts if conflict["operation_id"] == f"op-queue-b-{unique_suffix}")

    resolve_response = await async_client.post(f"/conflicts/{conflict_id}/resolve", headers=auth_headers)
    resolve_response.raise_for_status()
    assert _body(resolve_response)["resolved"] is True


@pytest.mark.asyncio
async def test_revision_integrity(async_client, auth_headers, db_session, unique_suffix):
    client = await _create_client(async_client, auth_headers, client_code=f"REV-{unique_suffix}")
    await _create_inventory(async_client, auth_headers, sku=f"REV-SKU-{unique_suffix}", quantity_on_hand=2)

    update_response = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            device_id="DEVICE-A",
            operation_id=f"op-rev-update-{unique_suffix}",
            entity="Client",
            operation="UPDATE",
            entity_id=client["id"],
            local_revision=client["server_revision"],
            data={
                "client_code": client["client_code"],
                "full_name": "Revision Updated Client",
                "preferred_language": "en",
                "city": "Juba",
                "notes": "revision integrity",
            },
        ),
    )
    update_response.raise_for_status()
    assert _meta(update_response)["revision"] > 0

    event_count = db_session.exec(select(func.count()).select_from(SyncEvent)).one()
    max_revision = db_session.exec(select(func.max(SyncEvent.server_revision))).one()
    assert event_count == max_revision


@pytest.mark.asyncio
async def test_randomized_sync_stability(async_client, auth_headers, db_session, unique_suffix):
    rng = random.Random(20260328)
    device_states = {
        "A": {"last_revision": 0},
        "B": {"last_revision": 0},
        "C": {"last_revision": 0},
    }
    active_clients: dict[str, int] = {}
    inventory_items: list[dict[str, str]] = []
    created_client_ids: set[str] = set()
    offline_device = "C"
    offline_steps = set(range(30, 46))

    for index in range(3):
        inventory = await _create_inventory(
            async_client,
            auth_headers,
            sku=f"RAND-{unique_suffix}-{index}",
            quantity_on_hand=20,
            sale_price_minor=2000 + (index * 250),
        )
        inventory_items.append(inventory)

    async def push_change(device_id: str, change: dict, *, replay_roll: bool = True):
        payload = {
            "deviceId": device_id,
            "lastPulledRevision": device_states[device_id]["last_revision"],
            "changes": [change],
        }
        response = await async_client.post("/sync/push", headers=auth_headers, json=payload)
        response.raise_for_status()
        body, meta = _sync_data(response)
        assert response.json()["status"] == "success"
        device_states[device_id]["last_revision"] = max(device_states[device_id]["last_revision"], meta["revision"])
        initial_status = body["results"][0]["status"]

        if replay_roll and rng.random() < 0.2:
            replay = await async_client.post("/sync/push", headers=auth_headers, json=payload)
            replay.raise_for_status()
            replay_body = _body(replay)
            replay_statuses = [result["status"] for result in replay_body["results"]]
            if initial_status == "APPLIED":
                assert all(status == "IDEMPOTENT_REPLAY" for status in replay_statuses)
            else:
                assert all(status in {"CONFLICT", "REJECTED"} for status in replay_statuses)

        if rng.random() >= 0.2:
            pull_response = await async_client.get(
                f"/sync/pull?since={device_states[device_id]['last_revision']}",
                headers=auth_headers,
            )
            pull_response.raise_for_status()
            pull_meta = _meta(pull_response)
            assert pull_response.json()["status"] == "success"
            assert pull_meta["revision"] >= device_states[device_id]["last_revision"]
            device_states[device_id]["last_revision"] = pull_meta["revision"]

        return body, meta

    for step in range(100):
        device_id = rng.choice(list(device_states))

        if device_id == offline_device and step in offline_steps:
            await asyncio.sleep(rng.uniform(0, 0.02))
            continue

        operation = rng.choice(
            [
                "create_client",
                "update_client",
                "delete_client",
                "create_invoice",
                "create_appointment",
            ]
        )

        if operation == "create_client" or not active_clients:
            client_id = uuid4().hex
            change = {
                "operationId": str(uuid4()),
                "entity": "Client",
                "operation": "CREATE",
                "entityId": client_id,
                "localRevision": rng.randint(0, 2),
                "data": {
                    "client_code": f"RAND-CL-{unique_suffix}-{step}",
                    "full_name": f"Random Client {step}",
                    "preferred_language": "en",
                    "city": "Juba",
                },
            }
            body, meta = await push_change(device_id, change)
            result = body["results"][0]
            if result["status"] == "APPLIED":
                active_clients[client_id] = body["applied"][0]["serverRevision"]
                created_client_ids.add(client_id)
            await asyncio.sleep(rng.uniform(0, 0.02))
            continue

        client_id = rng.choice(list(active_clients))
        known_revision = active_clients[client_id]
        stale_revision = max(0, known_revision - rng.randint(0, 2))

        if operation == "update_client":
            change = {
                "operationId": str(uuid4()),
                "entity": "Client",
                "operation": "UPDATE",
                "entityId": client_id,
                "localRevision": stale_revision,
                "data": {
                    "client_code": f"RAND-UP-{unique_suffix}-{step}",
                    "full_name": f"Updated Client {step}",
                    "preferred_language": "en",
                    "city": "Juba",
                    "notes": f"random-update-{step}",
                },
            }
            body, meta = await push_change(device_id, change)
            result = body["results"][0]
            if result["status"] == "APPLIED":
                active_clients[client_id] = body["applied"][0]["serverRevision"]

        elif operation == "delete_client":
            change = {
                "operationId": str(uuid4()),
                "entity": "Client",
                "operation": "DELETE",
                "entityId": client_id,
                "localRevision": known_revision if rng.random() < 0.7 else stale_revision,
                "data": {},
            }
            body, meta = await push_change(device_id, change)
            result = body["results"][0]
            if result["status"] == "APPLIED":
                active_clients.pop(client_id, None)

        elif operation == "create_invoice":
            inventory = rng.choice(inventory_items)
            quantity = rng.randint(1, 6)
            change = {
                "operationId": str(uuid4()),
                "entity": "Invoice",
                "operation": "CREATE",
                "entityId": uuid4().hex,
                "localRevision": rng.randint(0, 2),
                "data": {
                    "invoice_number": f"RAND-INV-{unique_suffix}-{step}",
                    "client_id": client_id,
                    "payment_method": "CASH",
                    "items": [{"sku": inventory["sku"], "qty": quantity}],
                },
            }
            await push_change(device_id, change)

        else:
            start_hour = 8 + rng.randint(0, 8)
            duration_hours = 1
            change = {
                "operationId": str(uuid4()),
                "entity": "Appointment",
                "operation": "CREATE",
                "entityId": uuid4().hex,
                "localRevision": rng.randint(0, 2),
                "data": {
                    "client_id": client_id,
                    "service_type": "Consultation",
                    "staff_name": rng.choice(["Dr. Lemi", "Dr. John", "Dr. Asha"]),
                    "starts_at": f"2026-04-01T{start_hour - 2:02d}:00:00Z",
                    "ends_at": f"2026-04-01T{start_hour + duration_hours - 2:02d}:00:00Z",
                    "status": "PENDING",
                },
            }
            await push_change(device_id, change)

        await asyncio.sleep(rng.uniform(0, 0.02))

    final_revision = db_session.exec(select(func.max(SyncEvent.server_revision))).one() or 0
    for device_id in device_states:
        pull_response = await async_client.get(
            f"/sync/pull?since={device_states[device_id]['last_revision']}",
            headers=auth_headers,
        )
        pull_response.raise_for_status()
        device_states[device_id]["last_revision"] = _meta(pull_response)["revision"]

    server_client_ids = set(db_session.exec(select(Client.id)).all())
    assert all(state["last_revision"] == final_revision for state in device_states.values())
    assert created_client_ids.issubset(server_client_ids)
    _assert_revision_integrity(db_session)
    _assert_no_negative_inventory(db_session)
    _assert_no_duplicate_operations(db_session)
