from __future__ import annotations

import json
import importlib
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.db.models import Client, Invoice, MessageEvent, User
from app.db.repos import (
    SYNC_ENTITY_MODELS,
    advance_device_cursor,
    append_sync_event,
    apply_server_revision,
    claim_entity_field_clock,
    ensure_monotonic_device_cursor,
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
INVENTORY_CRDT_SAFE_FIELDS = {"name", "category", "batch_number", "expires_on"}
INVENTORY_STRICT_FIELDS = {"sku", "quantity_on_hand", "reorder_level", "unit_cost_minor", "sale_price_minor"}
APPOINTMENT_CRDT_SAFE_FIELDS = {"status", "notes", "reminder_sent_at"}
APPOINTMENT_STRICT_FIELDS = {"service_type", "staff_name", "starts_at", "ends_at", "client_id"}
DEFAULT_APPOINTMENT_SLOT_STEP_MINUTES = 15
DEFAULT_APPOINTMENT_WORKDAY_START_HOUR = 8
DEFAULT_APPOINTMENT_WORKDAY_END_HOUR = 18
DEFAULT_APPOINTMENT_SUGGESTION_MAX_ATTEMPTS = 7 * 24 * 4


def _settings():
    # Resolve settings lazily to remain stable across config module reloads in tests.
    return importlib.import_module("app.core.config").settings


def _configured_appointment_zone() -> ZoneInfo:
    try:
        return ZoneInfo(_settings().appointment_timezone)
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def _parse_datetime_value(value: Any) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    else:
        raise TypeError("Unsupported datetime value.")

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=_configured_appointment_zone())
    return parsed.astimezone(UTC)


def _is_valid_utc_iso_datetime_string(value: str) -> bool:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    if parsed.tzinfo is None:
        return False
    if parsed.utcoffset() != timedelta(0):
        return False
    return value.endswith("Z") or value.endswith("+00:00")


def _slot_step_minutes() -> int:
    step = int(_settings().appointment_slot_step_minutes or DEFAULT_APPOINTMENT_SLOT_STEP_MINUTES)
    return min(max(step, 5), 120)


def _workday_start_hour() -> int:
    start = int(_settings().appointment_workday_start_hour or DEFAULT_APPOINTMENT_WORKDAY_START_HOUR)
    return min(max(start, 0), 22)


def _workday_end_hour() -> int:
    end = int(_settings().appointment_workday_end_hour or DEFAULT_APPOINTMENT_WORKDAY_END_HOUR)
    return min(max(end, _workday_start_hour() + 1), 23)


def _suggestion_max_attempts() -> int:
    attempts = int(_settings().appointment_suggestion_max_attempts or DEFAULT_APPOINTMENT_SUGGESTION_MAX_ATTEMPTS)
    return min(max(attempts, 24), 7 * 24 * 12)


def _filtered_payload(entity: str, data: dict[str, Any]) -> dict[str, Any]:
    payload = {key: value for key, value in data.items() if key in ENTITY_FIELDS[entity]}
    for field in {"starts_at", "ends_at", "reminder_sent_at", "sent_at", "issued_at", "expires_on"}:
        value = payload.get(field)
        if value is not None:
            try:
                payload[field] = _parse_datetime_value(value)
            except (TypeError, ValueError):
                continue
    return payload


def _parse_crdt_meta(change: dict[str, Any]) -> tuple[list[str], dict[str, int]]:
    raw_data = change.get("data", {})
    raw_crdt = raw_data.get("_crdt") if isinstance(raw_data, dict) else None
    if not isinstance(raw_crdt, dict):
        return [], {}

    raw_changed_fields = raw_crdt.get("changedFields", [])
    changed_fields = [str(field) for field in raw_changed_fields if isinstance(field, str)]
    raw_field_clocks = raw_crdt.get("fieldClocks", {})
    field_clocks: dict[str, int] = {}
    if isinstance(raw_field_clocks, dict):
        for field_name, clock in raw_field_clocks.items():
            if isinstance(field_name, str):
                try:
                    field_clocks[field_name] = max(0, int(clock))
                except (TypeError, ValueError):
                    continue
    return changed_fields, field_clocks


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
    if change.get("entity") == "Appointment" and change.get("operation", "").upper() in {"CREATE", "UPDATE"}:
        payload_data = change.get("data", {})
        if isinstance(payload_data, dict):
            for field in ("starts_at", "ends_at"):
                if field not in payload_data:
                    continue
                value = payload_data[field]
                if not isinstance(value, str) or not _is_valid_utc_iso_datetime_string(value):
                    raise ValueError(
                        f"Invalid {field}. Appointment sync payloads must use UTC ISO timestamps "
                        "(e.g. 2026-04-01T09:00:00Z)."
                    )


def _apply_client_crdt_merge(
    session: Session,
    *,
    existing: Client,
    incoming: dict[str, Any],
    changed_fields: list[str],
    field_clocks: dict[str, int],
    fallback_clock: int,
    device_id: str,
    operation_id: str,
    tenant_id: str,
) -> tuple[int, dict[str, Any], list[str]]:
    if not changed_fields:
        changed_fields = list(incoming.keys())

    merged_fields: dict[str, Any] = {}
    skipped_fields: list[str] = []

    for field in changed_fields:
        if field not in ENTITY_FIELDS["Client"] or field not in incoming:
            continue
        incoming_clock = field_clocks.get(field, fallback_clock)
        apply_field = claim_entity_field_clock(
            session,
            entity_type="Client",
            entity_id=existing.id,
            field_name=field,
            lamport_counter=incoming_clock,
            device_id=device_id,
        )
        if not apply_field:
            skipped_fields.append(field)
            continue

        next_value = incoming[field]
        if getattr(existing, field, None) != next_value:
            setattr(existing, field, next_value)
            merged_fields[field] = next_value

    touch_for_update(existing)
    event = append_sync_event(
        session,
        entity="Client",
        operation="UPDATE",
        entity_id=existing.id,
        payload={
            "merged_fields": merged_fields,
            "skipped_fields": skipped_fields,
            "changed_fields": changed_fields,
            "incoming": incoming,
        },
        operation_id=operation_id,
        device_id=device_id,
        tenant_id=tenant_id,
        resolution_type="CRDT_MERGED",
        resolved=True,
    )
    apply_server_revision(existing, event.server_revision or 0)
    session.add(existing)
    return event.server_revision or 0, merged_fields, skipped_fields


def _apply_inventory_crdt_merge(
    session: Session,
    *,
    existing: Any,
    incoming: dict[str, Any],
    changed_fields: list[str],
    field_clocks: dict[str, int],
    fallback_clock: int,
    device_id: str,
    operation_id: str,
    tenant_id: str,
) -> tuple[int, dict[str, Any], list[str]]:
    if not changed_fields:
        changed_fields = list(incoming.keys())

    merged_fields: dict[str, Any] = {}
    skipped_fields: list[str] = []

    for field in changed_fields:
        if field not in INVENTORY_CRDT_SAFE_FIELDS or field not in incoming:
            continue
        incoming_clock = field_clocks.get(field, fallback_clock)
        apply_field = claim_entity_field_clock(
            session,
            entity_type="InventoryItem",
            entity_id=existing.id,
            field_name=field,
            lamport_counter=incoming_clock,
            device_id=device_id,
        )
        if not apply_field:
            skipped_fields.append(field)
            continue

        next_value = incoming[field]
        if getattr(existing, field, None) != next_value:
            setattr(existing, field, next_value)
            merged_fields[field] = next_value

    touch_for_update(existing)
    event = append_sync_event(
        session,
        entity="InventoryItem",
        operation="UPDATE",
        entity_id=existing.id,
        payload={
            "merged_fields": merged_fields,
            "skipped_fields": skipped_fields,
            "changed_fields": changed_fields,
            "incoming": incoming,
        },
        operation_id=operation_id,
        device_id=device_id,
        tenant_id=tenant_id,
        resolution_type="CRDT_MERGED",
        resolved=True,
    )
    apply_server_revision(existing, event.server_revision or 0)
    session.add(existing)
    return event.server_revision or 0, merged_fields, skipped_fields


def _apply_appointment_crdt_merge(
    session: Session,
    *,
    existing: Any,
    incoming: dict[str, Any],
    changed_fields: list[str],
    field_clocks: dict[str, int],
    fallback_clock: int,
    device_id: str,
    operation_id: str,
    tenant_id: str,
) -> tuple[int, dict[str, Any], list[str]]:
    if not changed_fields:
        changed_fields = list(incoming.keys())

    merged_fields: dict[str, Any] = {}
    skipped_fields: list[str] = []

    for field in changed_fields:
        if field not in APPOINTMENT_CRDT_SAFE_FIELDS or field not in incoming:
            continue
        incoming_clock = field_clocks.get(field, fallback_clock)
        apply_field = claim_entity_field_clock(
            session,
            entity_type="Appointment",
            entity_id=existing.id,
            field_name=field,
            lamport_counter=incoming_clock,
            device_id=device_id,
        )
        if not apply_field:
            skipped_fields.append(field)
            continue

        next_value = incoming[field]
        if getattr(existing, field, None) != next_value:
            setattr(existing, field, next_value)
            merged_fields[field] = next_value

    touch_for_update(existing)
    event = append_sync_event(
        session,
        entity="Appointment",
        operation="UPDATE",
        entity_id=existing.id,
        payload={
            "merged_fields": merged_fields,
            "skipped_fields": skipped_fields,
            "changed_fields": changed_fields,
            "incoming": incoming,
        },
        operation_id=operation_id,
        device_id=device_id,
        tenant_id=tenant_id,
        resolution_type="CRDT_MERGED",
        resolved=True,
    )
    apply_server_revision(existing, event.server_revision or 0)
    session.add(existing)
    return event.server_revision or 0, merged_fields, skipped_fields


def _appointment_suggestions(
    session: Session,
    staff_name: str,
    starts_at: datetime,
    ends_at: datetime,
    limit: int = 3,
    tenant_id: str | None = None,
) -> list[dict[str, str]]:
    zone = _configured_appointment_zone()
    step_minutes = _slot_step_minutes()
    workday_start_hour = _workday_start_hour()
    workday_end_hour = _workday_end_hour()
    base_start_utc = _parse_datetime_value(starts_at)
    base_end_utc = _parse_datetime_value(ends_at)
    duration = max(base_end_utc - base_start_utc, timedelta(minutes=step_minutes))
    step = timedelta(minutes=step_minutes)

    candidate_local = base_start_utc.astimezone(zone) + step
    minute_offset = candidate_local.minute % step_minutes
    if minute_offset:
        candidate_local += timedelta(minutes=(step_minutes - minute_offset))
    candidate_local = candidate_local.replace(second=0, microsecond=0)

    suggestions: list[dict[str, str]] = []
    for _ in range(_suggestion_max_attempts()):
        if candidate_local.hour < workday_start_hour:
            candidate_local = candidate_local.replace(
                hour=workday_start_hour, minute=0, second=0, microsecond=0
            )

        latest_start_local = candidate_local.replace(
            hour=workday_end_hour, minute=0, second=0, microsecond=0
        ) - duration
        if candidate_local > latest_start_local:
            next_day = (candidate_local + timedelta(days=1)).replace(
                hour=workday_start_hour, minute=0, second=0, microsecond=0
            )
            candidate_local = next_day
            continue

        candidate_end_local = candidate_local + duration
        candidate_start_utc = candidate_local.astimezone(UTC)
        candidate_end_utc = candidate_end_local.astimezone(UTC)
        overlap = find_appointment_conflict(
            session,
            staff_name,
            candidate_start_utc,
            candidate_end_utc,
            tenant_id=tenant_id,
        )
        if not overlap:
            suggestions.append(
                {
                    "starts_at": candidate_local.isoformat(),
                    "ends_at": candidate_end_local.isoformat(),
                    "timezone": str(zone.key),
                }
            )
            if len(suggestions) >= limit:
                break
        candidate_local += step

    return suggestions


def _resolve_appointment_schedule_basis(existing: Any, incoming: dict[str, Any]) -> tuple[str | None, datetime | None, datetime | None]:
    staff_name = incoming.get("staff_name") if incoming.get("staff_name") is not None else getattr(existing, "staff_name", None)
    starts_at = incoming.get("starts_at") if incoming.get("starts_at") is not None else getattr(existing, "starts_at", None)
    ends_at = incoming.get("ends_at") if incoming.get("ends_at") is not None else getattr(existing, "ends_at", None)

    if not isinstance(starts_at, datetime) or not isinstance(ends_at, datetime):
        return staff_name, None, None

    starts_at = _parse_datetime_value(starts_at)
    ends_at = _parse_datetime_value(ends_at)

    if ends_at <= starts_at:
        ends_at = starts_at + timedelta(minutes=30)
    return staff_name, starts_at, ends_at


def _apply_generic_change(
    session: Session,
    change: dict[str, Any],
    payload: dict[str, Any],
    existing: Any | None,
    device_id: str,
    tenant_id: str,
) -> tuple[Any, int]:
    entity_name = change["entity"]
    model = SYNC_ENTITY_MODELS[entity_name]
    entity_id = change["entityId"]
    operation = change["operation"].upper()

    if operation == "CREATE" and not existing:
        record = model(id=entity_id, **payload)
        if hasattr(record, "tenant_id"):
            record.tenant_id = tenant_id
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
        if hasattr(record, "tenant_id"):
            record.tenant_id = tenant_id
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
        tenant_id=tenant_id,
    )
    apply_server_revision(record, event.server_revision or 0)
    session.add(record)
    return record, event.server_revision or 0


def _append_applied_result(
    *,
    applied: list[dict[str, Any]],
    results: list[dict[str, Any]],
    operation_id: str,
    entity_name: str,
    entity_id: str,
    server_revision: int,
    resolution: str | None = None,
    merged_fields: dict[str, Any] | None = None,
    skipped_fields: list[str] | None = None,
) -> None:
    applied.append({"entity": entity_name, "entityId": entity_id, "serverRevision": server_revision})
    result: dict[str, Any] = {
        "operationId": operation_id,
        "entity": entity_name,
        "entityId": entity_id,
        "status": "APPLIED",
    }
    if resolution:
        result["resolution"] = resolution
    if merged_fields is not None:
        result["mergedFields"] = merged_fields
    if skipped_fields is not None:
        result["skippedFields"] = skipped_fields
    results.append(result)


def _enqueue_and_append_conflict(
    *,
    session: Session,
    conflicts: list[dict[str, Any]],
    results: list[dict[str, Any]],
    operation_id: str,
    entity_name: str,
    entity_id: str,
    conflict_type: str,
    payload: dict[str, Any],
    tenant_id: str,
    resolution: str = "REQUIRES_USER_ACTION",
    result_status: str = "CONFLICT",
) -> None:
    enqueue_conflict(
        session,
        operation_id=operation_id,
        entity_type=entity_name,
        entity_id=entity_id,
        conflict_type=conflict_type,
        payload=payload,
        tenant_id=tenant_id,
    )
    conflicts.append(payload)
    results.append(
        {
            "operationId": operation_id,
            "entity": entity_name,
            "entityId": entity_id,
            "status": result_status,
            "resolution": resolution,
        }
    )


def _apply_stale_write_policy(
    *,
    session: Session,
    applied: list[dict[str, Any]],
    conflicts: list[dict[str, Any]],
    results: list[dict[str, Any]],
    change: dict[str, Any],
    operation_id: str,
    entity_name: str,
    entity_id: str,
    operation: str,
    local_revision: int,
    existing: Any | None,
    data: dict[str, Any],
    crdt_changed_fields: list[str],
    crdt_field_clocks: dict[str, int],
    device_id: str,
    tenant_id: str,
) -> bool:
    if not existing or local_revision >= existing.server_revision:
        return False

    if entity_name == "InventoryItem" and operation == "UPDATE":
        effective_changed_fields = crdt_changed_fields or list(data.keys())
        strict_fields = sorted({field for field in effective_changed_fields if field in INVENTORY_STRICT_FIELDS})
        if strict_fields:
            conflict = _conflict_payload(
                "INVENTORY_STRICT_FIELD_CONFLICT",
                entity_name,
                entity_id,
                change,
                existing.model_dump(mode="json"),
            )
            conflict["strictFields"] = strict_fields
            conflict["expectedServerRevision"] = existing.server_revision
            conflict["providedLocalRevision"] = local_revision
            _enqueue_and_append_conflict(
                session=session,
                conflicts=conflicts,
                results=results,
                operation_id=operation_id,
                entity_name=entity_name,
                entity_id=entity_id,
                conflict_type="INVENTORY_STRICT_FIELD_CONFLICT",
                payload=conflict,
                tenant_id=tenant_id,
            )
            return True

        server_revision, merged_fields, skipped_fields = _apply_inventory_crdt_merge(
            session,
            existing=existing,
            incoming=data,
            changed_fields=effective_changed_fields,
            field_clocks=crdt_field_clocks,
            fallback_clock=local_revision,
            device_id=device_id,
            operation_id=operation_id,
            tenant_id=tenant_id,
        )
        _append_applied_result(
            applied=applied,
            results=results,
            operation_id=operation_id,
            entity_name=entity_name,
            entity_id=entity_id,
            server_revision=server_revision,
            resolution="CRDT_MERGED",
            merged_fields=merged_fields,
            skipped_fields=skipped_fields,
        )
        return True

    if entity_name == "Appointment" and operation == "UPDATE":
        effective_changed_fields = crdt_changed_fields or list(data.keys())
        strict_fields = sorted({field for field in effective_changed_fields if field in APPOINTMENT_STRICT_FIELDS})
        if strict_fields:
            conflict = _conflict_payload(
                "APPOINTMENT_SCHEDULE_CONFLICT",
                entity_name,
                entity_id,
                change,
                existing.model_dump(mode="json"),
            )
            conflict["strictFields"] = strict_fields
            conflict["expectedServerRevision"] = existing.server_revision
            conflict["providedLocalRevision"] = local_revision
            conflict["timezone"] = _settings().appointment_timezone
            staff_name, starts_at, ends_at = _resolve_appointment_schedule_basis(existing, data)
            if staff_name and starts_at and ends_at:
                suggestions = _appointment_suggestions(
                    session,
                    staff_name,
                    starts_at,
                    ends_at,
                    tenant_id=tenant_id,
                )
                conflict["serverSuggestedNextSlots"] = suggestions
                conflict["suggestedResolution"] = "RESCHEDULE"
                conflict["suggestedDurationMinutes"] = int((ends_at - starts_at).total_seconds() // 60)
                conflict["scheduleContext"] = {
                    "staff_name": staff_name,
                    "starts_at": starts_at.isoformat(),
                    "ends_at": ends_at.isoformat(),
                    "timezone": _settings().appointment_timezone,
                }
            _enqueue_and_append_conflict(
                session=session,
                conflicts=conflicts,
                results=results,
                operation_id=operation_id,
                entity_name=entity_name,
                entity_id=entity_id,
                conflict_type="APPOINTMENT_SCHEDULE_CONFLICT",
                payload=conflict,
                tenant_id=tenant_id,
            )
            return True

        server_revision, merged_fields, skipped_fields = _apply_appointment_crdt_merge(
            session,
            existing=existing,
            incoming=data,
            changed_fields=effective_changed_fields,
            field_clocks=crdt_field_clocks,
            fallback_clock=local_revision,
            device_id=device_id,
            operation_id=operation_id,
            tenant_id=tenant_id,
        )
        _append_applied_result(
            applied=applied,
            results=results,
            operation_id=operation_id,
            entity_name=entity_name,
            entity_id=entity_id,
            server_revision=server_revision,
            resolution="CRDT_MERGED",
            merged_fields=merged_fields,
            skipped_fields=skipped_fields,
        )
        return True

    if operation in {"UPDATE", "DELETE"} and entity_name != "Client":
        conflict = _conflict_payload("STALE_WRITE", entity_name, entity_id, change, existing.model_dump(mode="json"))
        conflict["expectedServerRevision"] = existing.server_revision
        conflict["providedLocalRevision"] = local_revision
        _enqueue_and_append_conflict(
            session=session,
            conflicts=conflicts,
            results=results,
            operation_id=operation_id,
            entity_name=entity_name,
            entity_id=entity_id,
            conflict_type="STALE_WRITE",
            payload=conflict,
            tenant_id=tenant_id,
        )
        return True

    if entity_name == "Message":
        return False

    conflict = _conflict_payload("CONFLICT", entity_name, entity_id, change, existing.model_dump(mode="json"))
    _enqueue_and_append_conflict(
        session=session,
        conflicts=conflicts,
        results=results,
        operation_id=operation_id,
        entity_name=entity_name,
        entity_id=entity_id,
        conflict_type="CONFLICT",
        payload=conflict,
        tenant_id=tenant_id,
    )
    return True


def _is_replay_only_push(session: Session, payload: dict[str, Any], tenant_id: str) -> bool:
    changes = payload.get("changes", [])
    if not changes:
        return False

    for change in changes:
        operation_id = change.get("operationId")
        if not operation_id:
            return False
        if get_sync_event_by_operation_id(session, operation_id, tenant_id=tenant_id):
            continue
        if get_conflict_by_operation_id(session, operation_id, tenant_id=tenant_id):
            continue
        return False

    return True


def _is_create_only_push(payload: dict[str, Any]) -> bool:
    changes = payload.get("changes", [])
    if not changes:
        return False
    return all(str(change.get("operation", "")).upper() == "CREATE" for change in changes)


def handle_sync_push(
    session: Session,
    payload: dict[str, Any],
    current_user: User | None = None,
) -> dict[str, Any]:
    applied: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []
    device_id = payload["deviceId"]
    tenant_id = current_user.tenant_id if current_user else "default"
    previous_revision = latest_server_revision(session, tenant_id=tenant_id)
    replay_only_push = _is_replay_only_push(session, payload, tenant_id)
    create_only_push = _is_create_only_push(payload)
    try:
        ensure_monotonic_device_cursor(
            session,
            device_id=device_id,
            incoming_revision=payload.get("lastPulledRevision", 0),
            direction="push",
        )
    except ValueError:
        if not (create_only_push or replay_only_push or _is_replay_only_push(session, payload, tenant_id)):
            raise

    for change in payload["changes"]:
        _validate_change(change)
        operation_id = change["operationId"]
        entity_name = change["entity"]
        entity_id = change["entityId"]
        operation = change["operation"].upper()
        local_revision = change["localRevision"]
        data = _filtered_payload(entity_name, change.get("data", {}))
        crdt_changed_fields, crdt_field_clocks = _parse_crdt_meta(change)

        duplicate = get_sync_event_by_operation_id(session, operation_id, tenant_id=tenant_id)
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

        existing_conflict = get_conflict_by_operation_id(session, operation_id, tenant_id=tenant_id)
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
                existing = get_active_by_id(session, SYNC_ENTITY_MODELS[entity_name], entity_id, tenant_id=tenant_id)

                if entity_name == "Client" and operation in {"UPDATE", "CREATE"} and existing:
                    server_revision, merged_fields, skipped_fields = _apply_client_crdt_merge(
                        session,
                        existing=existing,
                        incoming=data,
                        changed_fields=crdt_changed_fields,
                        field_clocks=crdt_field_clocks,
                        fallback_clock=local_revision,
                        device_id=device_id,
                        operation_id=operation_id,
                        tenant_id=tenant_id,
                    )
                    has_explicit_crdt = bool(crdt_changed_fields) or bool(crdt_field_clocks)
                    resolution = (
                        "AUTO_MERGED"
                        if local_revision < existing.server_revision and not has_explicit_crdt
                        else "CRDT_MERGED"
                    )
                    if resolution == "AUTO_MERGED":
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
                    _append_applied_result(
                        applied=applied,
                        results=results,
                        operation_id=operation_id,
                        entity_name=entity_name,
                        entity_id=entity_id,
                        server_revision=server_revision,
                        resolution=resolution,
                        merged_fields=merged_fields,
                        skipped_fields=skipped_fields,
                    )
                    continue

                stale_policy_handled = _apply_stale_write_policy(
                    session=session,
                    applied=applied,
                    conflicts=conflicts,
                    results=results,
                    change=change,
                    operation_id=operation_id,
                    entity_name=entity_name,
                    entity_id=entity_id,
                    operation=operation,
                    local_revision=local_revision,
                    existing=existing,
                    data=data,
                    crdt_changed_fields=crdt_changed_fields,
                    crdt_field_clocks=crdt_field_clocks,
                    device_id=device_id,
                    tenant_id=tenant_id,
                )
                if stale_policy_handled:
                    continue

                if entity_name == "Appointment" and operation in {"CREATE", "UPDATE"} and data.get("staff_name"):
                    overlap = find_appointment_conflict(
                        session,
                        data["staff_name"],
                        data["starts_at"],
                        data["ends_at"],
                        exclude_id=entity_id if existing else None,
                        tenant_id=tenant_id,
                    )
                    if overlap:
                        conflict = _conflict_payload(
                            "APPOINTMENT_OVERLAP",
                            entity_name,
                            entity_id,
                            change,
                            overlap.model_dump(mode="json"),
                        )
                        suggestions = _appointment_suggestions(
                            session,
                            data["staff_name"],
                            data["starts_at"],
                            data["ends_at"],
                            tenant_id=tenant_id,
                        )
                        conflict["timezone"] = _settings().appointment_timezone
                        conflict["serverSuggestedNextSlots"] = suggestions
                        conflict["suggestions"] = suggestions
                        conflict["scheduleContext"] = {
                            "staff_name": data["staff_name"],
                            "starts_at": data["starts_at"].isoformat(),
                            "ends_at": data["ends_at"].isoformat(),
                            "timezone": _settings().appointment_timezone,
                        }
                        enqueue_conflict(
                            session,
                            operation_id=operation_id,
                            entity_type=entity_name,
                            entity_id=entity_id,
                            conflict_type="APPOINTMENT_OVERLAP",
                            payload=conflict,
                            tenant_id=tenant_id,
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
                        actor_user_id=current_user.id if current_user else None,
                        actor_role=current_user.role if current_user else None,
                        tenant_id=tenant_id,
                        auto_commit=False,
                    )
                    applied.append({"entity": entity_name, "entityId": entity_id, "serverRevision": invoice.server_revision})
                    results.append({"operationId": operation_id, "entity": entity_name, "entityId": entity_id, "status": "APPLIED"})
                    continue

                if entity_name == "Message" and operation == "CREATE":
                    message = MessageEvent(
                        id=entity_id,
                        tenant_id=tenant_id,
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
                        tenant_id=tenant_id,
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
                            tenant_id=tenant_id,
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

                record, server_revision = _apply_generic_change(session, change, data, existing, device_id, tenant_id)
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
                    tenant_id=tenant_id,
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
            existing = get_sync_event_by_operation_id(session, operation_id, tenant_id=tenant_id)
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
        for event in list_sync_events_since(
            session,
            payload.get("lastPulledRevision", 0),
            tenant_id=tenant_id,
        )
    ]
    new_revision = server_changes[-1]["serverRevision"] if server_changes else payload.get("lastPulledRevision", 0)
    advance_device_cursor(
        session,
        device_id=device_id,
        revision=new_revision,
        direction="push",
        operation_id=payload["changes"][-1]["operationId"] if payload.get("changes") else None,
    )
    session.commit()
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
