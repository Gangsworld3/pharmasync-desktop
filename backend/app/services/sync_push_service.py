from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.db.models import Client, Invoice, MessageEvent
from app.db.repositories import (
    SYNC_ENTITY_MODELS,
    append_sync_event,
    apply_server_revision,
    enqueue_conflict,
    find_appointment_conflict,
    get_active_by_id,
    get_conflict_by_operation_id,
    get_sync_event_by_operation_id,
    latest_server_revision,
    list_sync_events_since,
    mark_deleted,
    touch_for_update,
)
from app.services.invoice_service import InvoiceItemInput, create_invoice

ENTITY_FIELDS: dict[str, set[str]] = {
    "Client": {"client_code", "full_name", "phone", "email", "preferred_language", "city", "notes"},
    "InventoryItem": {
        "sku",
        "name",
        "category",
        "quantity_on_hand",
        "reorder_level",
        "unit_cost_minor",
        "sale_price_minor",
        "batch_number",
        "expires_on",
    },
    "Appointment": {"client_id", "service_type", "staff_name", "starts_at", "ends_at", "status", "reminder_sent_at", "notes"},
    "Message": {"conversation_id", "sender_id", "content", "created_at"},
    "Invoice": {"invoice_number", "client_id", "currency_code", "payment_method", "status", "issued_at", "items"},
}


def _filtered_payload(entity: str, data: dict[str, Any]) -> dict[str, Any]:
    payload = {key: value for key, value in data.items() if key in ENTITY_FIELDS[entity]}
    for field in {"starts_at", "ends_at", "reminder_sent_at", "sent_at", "issued_at", "expires_on"}:
        value = payload.get(field)
        if isinstance(value, str):
            payload[field] = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return payload


def _conflict_payload(
    conflict_type: str,
    entity_name: str,
    entity_id: str,
    change: dict[str, Any],
    server: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = {
        "type": conflict_type,
        "entity": entity_name,
        "entityId": entity_id,
        "local": change,
        "resolution": "REQUIRES_USER_ACTION",
    }
    if server is not None:
        payload["server"] = server
    return payload


def _parse_invoice_items(data: dict[str, Any]) -> list[InvoiceItemInput]:
    parsed_items: list[InvoiceItemInput] = []
    for item in data.get("items", []):
        inventory_sku = item.get("inventory_sku") or item.get("sku")
        quantity = item.get("quantity", item.get("qty"))
        parsed_items.append(
            InvoiceItemInput(
                inventory_sku=inventory_sku,
                quantity=Decimal(str(quantity)),
                unit_price_minor=item.get("unit_price_minor"),
                description=item.get("description"),
            )
        )
    return parsed_items


def _validate_change(change: dict[str, Any]) -> None:
    if not change.get("operationId"):
        raise ValueError("Missing operationId.")
    if change.get("entity") not in SYNC_ENTITY_MODELS:
        raise ValueError(f"Unsupported entity: {change.get('entity')}.")
    if change.get("operation", "").upper() not in {"CREATE", "UPDATE", "DELETE"}:
        raise ValueError(f"Unsupported operation: {change.get('operation')}.")
    if not change.get("entityId"):
        raise ValueError("Missing entityId.")
    if change.get("entity") == "Message" and change.get("operation", "").upper() != "CREATE":
        raise ValueError("Messages are append-only and only support CREATE.")


def _merge_client(existing: Client, incoming: dict[str, Any]) -> dict[str, Any]:
    merged_fields: dict[str, Any] = {}
    for field, value in incoming.items():
        if value is not None and getattr(existing, field, None) != value:
            setattr(existing, field, value)
            merged_fields[field] = value
    touch_for_update(existing)
    return merged_fields


def _appointment_suggestions(
    session: Session, staff_name: str, starts_at: datetime, ends_at: datetime, limit: int = 3
) -> list[str]:
    duration = ends_at - starts_at
    candidate = starts_at + timedelta(minutes=30)
    suggestions: list[str] = []

    for _ in range(24):
        candidate_end = candidate + duration
        overlap = find_appointment_conflict(session, staff_name, candidate, candidate_end)
        if not overlap:
            suggestions.append(candidate.strftime("%H:%M"))
            if len(suggestions) >= limit:
                break
        candidate += timedelta(minutes=30)

    return suggestions


def _apply_generic_change(
    session: Session,
    change: dict[str, Any],
    payload: dict[str, Any],
    existing: Any | None,
    device_id: str,
) -> tuple[Any, int]:
    entity_name = change["entity"]
    model = SYNC_ENTITY_MODELS[entity_name]
    entity_id = change["entityId"]
    operation = change["operation"].upper()

    if operation == "CREATE" and not existing:
        record = model(id=entity_id, **payload)
        session.add(record)
        session.flush()
    elif operation in {"UPDATE", "CREATE"} and existing:
        record = existing
        for field, value in payload.items():
            setattr(record, field, value)
        touch_for_update(record)
    elif operation == "DELETE" and existing:
        record = mark_deleted(existing)
    else:
        record = model(id=entity_id, **payload)
        session.add(record)
        session.flush()

    event = append_sync_event(
        session,
        entity=entity_name,
        operation=operation,
        entity_id=entity_id,
        payload=payload if operation != "DELETE" else {"deleted_at": str(record.deleted_at)},
        operation_id=change["operationId"] or str(uuid.uuid4()),
        device_id=device_id,
    )
    apply_server_revision(record, event.server_revision or 0)
    session.add(record)
    return record, event.server_revision or 0


def handle_sync_push(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    applied: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []
    device_id = payload["deviceId"]
    previous_revision = latest_server_revision(session)

    for change in payload["changes"]:
        _validate_change(change)
        operation_id = change["operationId"]
        entity_name = change["entity"]
        entity_id = change["entityId"]
        operation = change["operation"].upper()
        local_revision = change["localRevision"]
        data = _filtered_payload(entity_name, change.get("data", {}))

        duplicate = get_sync_event_by_operation_id(session, operation_id)
        if duplicate:
            results.append(
                {
                    "operationId": operation_id,
                    "entity": entity_name,
                    "entityId": entity_id,
                    "status": "IDEMPOTENT_REPLAY",
                    "serverRevision": duplicate.server_revision,
                }
            )
            continue

        existing_conflict = get_conflict_by_operation_id(session, operation_id)
        if existing_conflict:
            payload_json = json.loads(existing_conflict.payload_json)
            conflicts.append(payload_json)
            results.append(
                {
                    "operationId": operation_id,
                    "entity": entity_name,
                    "entityId": entity_id,
                    "status": "CONFLICT",
                    "resolution": "REQUIRES_USER_ACTION",
                }
            )
            continue

        try:
            with session.begin_nested():
                existing = get_active_by_id(session, SYNC_ENTITY_MODELS[entity_name], entity_id)

                if existing and local_revision < existing.server_revision:
                    if entity_name == "Client" and operation in {"UPDATE", "CREATE"}:
                        merged_fields = _merge_client(existing, data)
                        event = append_sync_event(
                            session,
                            entity=entity_name,
                            operation="UPDATE",
                            entity_id=entity_id,
                            payload={"merged_fields": merged_fields, "data": data},
                            operation_id=operation_id,
                            device_id=device_id,
                            resolution_type="AUTO_MERGED",
                            resolved=True,
                        )
                        apply_server_revision(existing, event.server_revision or 0)
                        session.add(existing)
                        applied.append({"entity": entity_name, "entityId": entity_id, "serverRevision": event.server_revision})
                        conflicts.append(
                            {
                                "type": "CLIENT_MERGE",
                                "entity": entity_name,
                                "entityId": entity_id,
                                "local": change,
                                "server": existing.model_dump(mode="json"),
                                "resolution": "AUTO_MERGED",
                                "mergedFields": merged_fields,
                            }
                        )
                        results.append(
                            {
                                "operationId": operation_id,
                                "entity": entity_name,
                                "entityId": entity_id,
                                "status": "APPLIED",
                                "resolution": "AUTO_MERGED",
                            }
                        )
                        continue

                    if entity_name == "Message":
                        existing = None
                    else:
                        conflict = _conflict_payload("CONFLICT", entity_name, entity_id, change, existing.model_dump(mode="json"))
                        enqueue_conflict(
                            session,
                            operation_id=operation_id,
                            entity_type=entity_name,
                            entity_id=entity_id,
                            conflict_type="CONFLICT",
                            payload=conflict,
                        )
                        conflicts.append(conflict)
                        results.append(
                            {
                                "operationId": operation_id,
                                "entity": entity_name,
                                "entityId": entity_id,
                                "status": "CONFLICT",
                            }
                        )
                        continue

                if entity_name == "Appointment" and operation in {"CREATE", "UPDATE"} and data.get("staff_name"):
                    overlap = find_appointment_conflict(
                        session,
                        data["staff_name"],
                        data["starts_at"],
                        data["ends_at"],
                        exclude_id=entity_id if existing else None,
                    )
                    if overlap:
                        conflict = _conflict_payload(
                            "APPOINTMENT_OVERLAP",
                            entity_name,
                            entity_id,
                            change,
                            overlap.model_dump(mode="json"),
                        )
                        conflict["suggestions"] = _appointment_suggestions(
                            session,
                            data["staff_name"],
                            data["starts_at"],
                            data["ends_at"],
                        )
                        enqueue_conflict(
                            session,
                            operation_id=operation_id,
                            entity_type=entity_name,
                            entity_id=entity_id,
                            conflict_type="APPOINTMENT_OVERLAP",
                            payload=conflict,
                        )
                        conflicts.append(conflict)
                        results.append(
                            {
                                "operationId": operation_id,
                                "entity": entity_name,
                                "entityId": entity_id,
                                "status": "CONFLICT",
                                "resolution": "REQUIRES_USER_ACTION",
                            }
                        )
                        continue

                if entity_name == "Invoice" and operation == "CREATE":
                    invoice = Invoice(
                        id=entity_id,
                        invoice_number=data["invoice_number"],
                        client_id=data.get("client_id"),
                        currency_code=data.get("currency_code", "SSP"),
                        total_minor=0,
                        balance_due_minor=0,
                        payment_method=data["payment_method"],
                        status=data.get("status", "ISSUED"),
                    )
                    create_invoice(
                        session,
                        invoice,
                        _parse_invoice_items(data),
                        device_id=device_id,
                        operation_id=operation_id,
                        auto_commit=False,
                    )
                    applied.append({"entity": entity_name, "entityId": entity_id, "serverRevision": invoice.server_revision})
                    results.append({"operationId": operation_id, "entity": entity_name, "entityId": entity_id, "status": "APPLIED"})
                    continue

                if entity_name == "Message" and operation == "CREATE":
                    message = MessageEvent(
                        id=entity_id,
                        conversation_id=data["conversation_id"],
                        sender_id=data["sender_id"],
                        content=data["content"],
                        created_at=data.get("created_at") or datetime.now(UTC),
                    )
                    session.add(message)
                    session.flush()
                    event = append_sync_event(
                        session,
                        entity="Message",
                        operation="CREATE",
                        entity_id=entity_id,
                        payload=message.model_dump(mode="json"),
                        operation_id=operation_id,
                        device_id=device_id,
                    )
                    apply_server_revision(message, event.server_revision or 0)
                    session.add(message)
                    applied.append({"entity": entity_name, "entityId": entity_id, "serverRevision": message.server_revision})
                    results.append({"operationId": operation_id, "entity": entity_name, "entityId": entity_id, "status": "APPLIED"})
                    continue

                if entity_name == "InventoryItem" and operation in {"CREATE", "UPDATE"} and "quantity_on_hand" in data and Decimal(str(data["quantity_on_hand"])) < 0:
                    conflict = _conflict_payload(
                        "INSUFFICIENT_STOCK",
                        entity_name,
                        entity_id,
                        change,
                        existing.model_dump(mode="json") if existing else None,
                    )
                    enqueue_conflict(
                        session,
                        operation_id=operation_id,
                        entity_type=entity_name,
                        entity_id=entity_id,
                        conflict_type="INSUFFICIENT_STOCK",
                        payload=conflict,
                    )
                    conflicts.append(conflict)
                    results.append(
                        {
                            "operationId": operation_id,
                            "entity": entity_name,
                            "entityId": entity_id,
                            "status": "REJECTED",
                            "resolution": "REQUIRES_USER_ACTION",
                        }
                    )
                    continue

                record, server_revision = _apply_generic_change(session, change, data, existing, device_id)
                applied.append({"entity": entity_name, "entityId": entity_id, "serverRevision": server_revision})
                results.append({"operationId": operation_id, "entity": entity_name, "entityId": entity_id, "status": "APPLIED"})
        except ValueError as exc:
            conflict_type = "INSUFFICIENT_STOCK" if "Insufficient stock" in str(exc) else "REJECTED"
            conflict_payload = _conflict_payload(conflict_type, entity_name, entity_id, change)
            if entity_name != "Message":
                enqueue_conflict(
                    session,
                    operation_id=operation_id,
                    entity_type=entity_name,
                    entity_id=entity_id,
                    conflict_type=conflict_type,
                    payload=conflict_payload,
                )
            conflicts.append(conflict_payload)
            results.append(
                {
                    "operationId": operation_id,
                    "entity": entity_name,
                    "entityId": entity_id,
                    "status": "REJECTED",
                    "error": str(exc),
                    "resolution": "REQUIRES_USER_ACTION",
                }
            )
        except IntegrityError:
            session.rollback()
            existing = get_sync_event_by_operation_id(session, operation_id)
            if existing:
                results.append(
                    {
                        "operationId": operation_id,
                        "entity": entity_name,
                        "entityId": entity_id,
                        "status": "IDEMPOTENT_REPLAY",
                        "serverRevision": existing.server_revision,
                    }
                )
            else:
                conflicts.append(_conflict_payload("INTEGRITY_ERROR", entity_name, entity_id, change))
                results.append({"operationId": operation_id, "entity": entity_name, "entityId": entity_id, "status": "REJECTED"})

    session.commit()

    server_changes = [
        {
            "serverRevision": event.server_revision,
            "entity": event.entity,
            "operation": event.operation,
            "entityId": event.entity_id,
            "data": json.loads(event.payload_json),
            "resolutionType": event.resolution_type,
            "resolved": event.resolved,
        }
        for event in list_sync_events_since(session, payload.get("lastPulledRevision", 0))
    ]
    new_revision = server_changes[-1]["serverRevision"] if server_changes else payload.get("lastPulledRevision", 0)
    applied_revisions = [entry["serverRevision"] for entry in applied if entry.get("serverRevision") is not None]
    if applied_revisions:
        assert max(applied_revisions) > previous_revision

    return {
        "newRevision": new_revision,
        "applied": applied,
        "conflicts": conflicts,
        "serverChanges": server_changes,
        "results": results,
    }
