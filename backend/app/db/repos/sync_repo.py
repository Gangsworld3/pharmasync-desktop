from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlalchemy import text
from sqlmodel import Session, select

from app.db.models import (
    AuditLog,
    ConflictQueue,
    DeviceSyncState,
    ServerState,
    SyncEvent,
    SyncEventAudit,
)
from app.db.repos.entity_repo import utc_now


def _canonical_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, default=str, sort_keys=True, separators=(",", ":"))


def _hash_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _compute_event_hash(
    *,
    server_revision: int,
    operation_id: str,
    entity: str,
    operation: str,
    entity_id: str,
    payload_hash: str,
    previous_event_hash: str | None,
) -> str:
    previous_hash = previous_event_hash or "GENESIS"
    canonical = "|".join(
        [
            str(server_revision),
            operation_id,
            entity,
            operation,
            entity_id,
            payload_hash,
            previous_hash,
        ]
    )
    return _hash_hex(canonical)


def append_sync_event(
    session: Session,
    *,
    entity: str,
    operation: str,
    entity_id: str,
    payload: dict[str, Any],
    operation_id: str,
    device_id: str | None = None,
    tenant_id: str = "default",
    resolution_type: str | None = None,
    resolved: bool = False,
) -> SyncEvent:
    state = session.exec(select(ServerState).where(ServerState.scope == "global").with_for_update()).first()
    if state is None:
        state = ServerState(scope="global", current_revision=0)
        session.add(state)
        session.flush()

    state.current_revision += 1
    state.updated_at = utc_now()
    canonical_payload = _canonical_json(payload)
    event = SyncEvent(
        server_revision=state.current_revision,
        tenant_id=tenant_id,
        entity=entity,
        operation=operation,
        entity_id=entity_id,
        payload_json=canonical_payload,
        operation_id=operation_id,
        device_id=device_id,
        resolution_type=resolution_type,
        resolved=resolved,
    )
    session.add(state)
    session.add(event)
    session.flush()

    previous_hash = None
    if event.server_revision and event.server_revision > 1:
        previous = session.exec(
            select(SyncEventAudit)
            .where(SyncEventAudit.server_revision == event.server_revision - 1)
            .with_for_update()
        ).first()
        previous_hash = previous.event_hash if previous else None

    payload_hash = _hash_hex(event.payload_json)
    event_hash = _compute_event_hash(
        server_revision=event.server_revision or 0,
        operation_id=operation_id,
        entity=entity,
        operation=operation,
        entity_id=entity_id,
        payload_hash=payload_hash,
        previous_event_hash=previous_hash,
    )
    audit = SyncEventAudit(
        server_revision=event.server_revision or 0,
        operation_id=operation_id,
        payload_hash=payload_hash,
        previous_event_hash=previous_hash,
        event_hash=event_hash,
    )
    session.add(audit)
    session.flush()
    return event


def get_sync_event_by_operation_id(
    session: Session,
    operation_id: str,
    tenant_id: str | None = None,
) -> SyncEvent | None:
    query = select(SyncEvent).where(SyncEvent.operation_id == operation_id)
    if tenant_id:
        query = query.where(SyncEvent.tenant_id == tenant_id)
    return session.exec(query).first()


def latest_server_revision(session: Session, tenant_id: str | None = None) -> int:
    query = select(SyncEvent)
    if tenant_id:
        query = query.where(SyncEvent.tenant_id == tenant_id)
    query = query.order_by(SyncEvent.server_revision.desc())
    event = session.exec(query).first()
    return event.server_revision if event and event.server_revision else 0


def _lock_device_sync_state(session: Session, device_id: str) -> DeviceSyncState:
    state = session.exec(
        select(DeviceSyncState)
        .where(DeviceSyncState.device_id == device_id)
        .with_for_update()
    ).first()
    if state is None:
        state = DeviceSyncState(device_id=device_id, last_seen_revision=0)
        session.add(state)
        session.flush()
    return state


def ensure_monotonic_device_cursor(
    session: Session,
    *,
    device_id: str,
    incoming_revision: int,
    direction: str,
) -> DeviceSyncState:
    state = _lock_device_sync_state(session, device_id)
    if incoming_revision < state.last_seen_revision:
        raise ValueError(
            f"Device cursor regression for {device_id}: incoming={incoming_revision}, stored={state.last_seen_revision}."
        )

    now = utc_now()
    state.last_seen_revision = max(state.last_seen_revision, incoming_revision)
    if direction == "push":
        state.last_push_at = now
    else:
        state.last_pull_at = now
    state.updated_at = now
    session.add(state)
    session.flush()
    return state


def advance_device_cursor(
    session: Session,
    *,
    device_id: str,
    revision: int,
    direction: str,
    operation_id: str | None = None,
) -> DeviceSyncState:
    state = _lock_device_sync_state(session, device_id)
    state.last_seen_revision = max(state.last_seen_revision, revision)
    now = utc_now()
    if direction == "push":
        state.last_push_at = now
    else:
        state.last_pull_at = now
    if operation_id:
        state.last_operation_id = operation_id
    state.updated_at = now
    session.add(state)
    session.flush()
    return state


def claim_entity_field_clock(
    session: Session,
    *,
    entity_type: str,
    entity_id: str,
    field_name: str,
    lamport_counter: int,
    device_id: str,
) -> bool:
    now = utc_now()
    statement = text(
        """
        INSERT INTO entity_field_clocks (
            entity_type, entity_id, field_name, lamport_counter, device_id, updated_at
        ) VALUES (
            :entity_type, :entity_id, :field_name, :lamport_counter, :device_id, :updated_at
        )
        ON CONFLICT (entity_type, entity_id, field_name)
        DO UPDATE
        SET
            lamport_counter = EXCLUDED.lamport_counter,
            device_id = EXCLUDED.device_id,
            updated_at = EXCLUDED.updated_at
        WHERE
            (entity_field_clocks.lamport_counter, entity_field_clocks.device_id)
            < (EXCLUDED.lamport_counter, EXCLUDED.device_id)
        RETURNING id
        """
    )
    result = session.exec(
        statement,
        params={
            "entity_type": entity_type,
            "entity_id": entity_id,
            "field_name": field_name,
            "lamport_counter": lamport_counter,
            "device_id": device_id,
            "updated_at": now,
        },
    ).first()
    return result is not None


def list_sync_events_since(session: Session, since: int, tenant_id: str | None = None) -> list[SyncEvent]:
    query = select(SyncEvent).where(SyncEvent.server_revision > since)
    if tenant_id:
        query = query.where(SyncEvent.tenant_id == tenant_id)
    query = query.order_by(SyncEvent.server_revision)
    return list(session.exec(query))


def list_sync_event_audit_since(session: Session, since: int, tenant_id: str | None = None) -> list[SyncEventAudit]:
    query = (
        select(SyncEventAudit)
        .join(SyncEvent, SyncEvent.server_revision == SyncEventAudit.server_revision)
        .where(SyncEventAudit.server_revision > since)
    )
    if tenant_id:
        query = query.where(SyncEvent.tenant_id == tenant_id)
    query = query.order_by(SyncEventAudit.server_revision)
    return list(session.exec(query))


def get_conflict_by_operation_id(
    session: Session,
    operation_id: str,
    tenant_id: str | None = None,
) -> ConflictQueue | None:
    query = select(ConflictQueue).where(ConflictQueue.operation_id == operation_id)
    if tenant_id:
        query = query.where(ConflictQueue.tenant_id == tenant_id)
    return session.exec(query).first()


def enqueue_conflict(
    session: Session,
    *,
    operation_id: str,
    entity_type: str,
    entity_id: str,
    conflict_type: str,
    payload: dict[str, Any],
    tenant_id: str = "default",
    requires_user_action: bool = True,
) -> ConflictQueue:
    existing = get_conflict_by_operation_id(session, operation_id, tenant_id=tenant_id)
    if existing:
        return existing

    conflict = ConflictQueue(
        tenant_id=tenant_id,
        operation_id=operation_id,
        entity_type=entity_type,
        entity_id=entity_id,
        conflict_type=conflict_type,
        payload_json=json.dumps(payload, default=str),
        requires_user_action=requires_user_action,
        resolved=False,
    )
    session.add(conflict)
    session.flush()
    return conflict


def list_conflicts(session: Session, *, tenant_id: str | None = None, resolved: bool | None = None) -> list[ConflictQueue]:
    query = select(ConflictQueue)
    if tenant_id:
        query = query.where(ConflictQueue.tenant_id == tenant_id)
    if resolved is not None:
        query = query.where(ConflictQueue.resolved == resolved)
    query = query.order_by(ConflictQueue.created_at.desc())
    return list(session.exec(query))


def resolve_conflict(session: Session, conflict_id: str, tenant_id: str | None = None) -> ConflictQueue | None:
    query = select(ConflictQueue).where(ConflictQueue.id == conflict_id)
    if tenant_id:
        query = query.where(ConflictQueue.tenant_id == tenant_id)
    conflict = session.exec(query).first()
    if not conflict:
        return None
    conflict.resolved = True
    session.add(conflict)
    session.commit()
    session.refresh(conflict)
    return conflict


def append_audit_log(
    session: Session,
    *,
    action: str,
    table_name: str,
    record_id: str,
    user_id: int | None = None,
    actor_role: str | None = None,
    tenant_id: str = "default",
    payload: dict[str, Any] | None = None,
) -> AuditLog:
    payload_json = None
    if payload is not None:
        payload_data: dict[str, Any] = dict(payload)
    else:
        payload_data = {}
    if user_id is not None or actor_role is not None:
        payload_data["_actor"] = {
            "user_id": user_id,
            "role": actor_role,
        }
    if payload_data:
        payload_json = json.dumps(payload_data, default=str)

    log = AuditLog(
        tenant_id=tenant_id,
        user_id=user_id,
        action=action,
        table_name=table_name,
        record_id=record_id,
        payload_json=payload_json,
    )
    session.add(log)
    session.flush()
    return log
