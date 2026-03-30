from __future__ import annotations

import json
import hashlib
from datetime import UTC, datetime
from typing import Any, Type

from sqlalchemy import text
from sqlmodel import Session, select

from app.db.models import (
    Appointment,
    AuditLog,
    Client,
    ConflictQueue,
    DeviceSyncState,
    IdempotencyKey,
    InventoryItem,
    Invoice,
    InvoiceLineItem,
    Message,
    MessageEvent,
    RefreshToken,
    ServerState,
    SyncEvent,
    SyncEventAudit,
    Tenant,
    User,
)


RESOURCE_MODELS: dict[str, Type[Any]] = {
    "clients": Client,
    "inventory": InventoryItem,
    "appointments": Appointment,
    "messages": MessageEvent,
    "invoices": Invoice,
}

SYNC_ENTITY_MODELS: dict[str, Type[Any]] = {
    "Client": Client,
    "InventoryItem": InventoryItem,
    "Appointment": Appointment,
    "Message": MessageEvent,
    "Invoice": Invoice,
}


def _scope_by_tenant(query: Any, model: Type[Any], tenant_id: str | None) -> Any:
    if tenant_id and hasattr(model, "tenant_id"):
        return query.where(model.tenant_id == tenant_id)
    return query


def utc_now() -> datetime:
    return datetime.now(UTC)


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


def list_active(session: Session, model: Type[Any], tenant_id: str | None = None) -> list[Any]:
    query = select(model)
    query = _scope_by_tenant(query, model, tenant_id)
    if hasattr(model, "deleted_at"):
        query = query.where(model.deleted_at.is_(None))
    if hasattr(model, "server_revision"):
        query = query.order_by(model.server_revision)
    elif hasattr(model, "created_at"):
        query = query.order_by(model.created_at)
    return list(session.exec(query))


def get_active_by_id(session: Session, model: Type[Any], entity_id: Any, tenant_id: str | None = None) -> Any | None:
    query = select(model).where(model.id == entity_id)
    query = _scope_by_tenant(query, model, tenant_id)
    if hasattr(model, "deleted_at"):
        query = query.where(model.deleted_at.is_(None))
    return session.exec(query).first()


def get_user_by_email(session: Session, email: str, tenant_id: str | None = None) -> User | None:
    query = select(User).where(User.email == email).where(User.deleted_at.is_(None))
    if tenant_id:
        query = query.where(User.tenant_id == tenant_id)
    return session.exec(query).first()


def get_inventory_by_sku(session: Session, sku: str, tenant_id: str | None = None) -> InventoryItem | None:
    query = select(InventoryItem).where(InventoryItem.sku == sku).where(InventoryItem.deleted_at.is_(None))
    if tenant_id:
        query = query.where(InventoryItem.tenant_id == tenant_id)
    return session.exec(query).first()


def get_inventory_by_sku_for_update(session: Session, sku: str, tenant_id: str | None = None) -> InventoryItem | None:
    query = (
        select(InventoryItem)
        .where(InventoryItem.sku == sku)
        .where(InventoryItem.deleted_at.is_(None))
        .with_for_update()
    )
    if tenant_id:
        query = query.where(InventoryItem.tenant_id == tenant_id)
    return session.exec(query).first()


def list_invoice_items(session: Session, invoice_id: str, tenant_id: str | None = None) -> list[InvoiceLineItem]:
    query = (
        select(InvoiceLineItem)
        .where(InvoiceLineItem.invoice_id == invoice_id)
        .where(InvoiceLineItem.deleted_at.is_(None))
    )
    if tenant_id:
        query = query.where(InvoiceLineItem.tenant_id == tenant_id)
    return list(session.exec(query))


def find_appointment_conflict(
    session: Session,
    staff_name: str,
    starts_at: datetime,
    ends_at: datetime,
    exclude_id: str | None = None,
    tenant_id: str | None = None,
) -> Appointment | None:
    query = (
        select(Appointment)
        .where(Appointment.staff_name == staff_name)
        .where(Appointment.deleted_at.is_(None))
        .where(Appointment.status != "CANCELLED")
        .where(Appointment.starts_at < ends_at)
        .where(Appointment.ends_at > starts_at)
    )
    if exclude_id:
        query = query.where(Appointment.id != exclude_id)
    if tenant_id:
        query = query.where(Appointment.tenant_id == tenant_id)
    return session.exec(query).first()


def touch_for_update(entity: Any) -> Any:
    entity.updated_at = utc_now()
    return entity


def mark_deleted(entity: Any) -> Any:
    entity.deleted_at = utc_now()
    entity.updated_at = utc_now()
    return entity


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


def apply_server_revision(entity: Any, server_revision: int) -> Any:
    entity.server_revision = server_revision
    if hasattr(entity, "updated_at"):
        entity.updated_at = utc_now()
    return entity


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


def create_tenant(session: Session, *, tenant_id: str, name: str, is_active: bool = True) -> Tenant:
    tenant = Tenant(id=tenant_id, name=name, is_active=is_active, updated_at=utc_now())
    session.add(tenant)
    session.flush()
    return tenant


def list_tenants(session: Session) -> list[Tenant]:
    return list(session.exec(select(Tenant).order_by(Tenant.created_at)))


def get_tenant(session: Session, tenant_id: str) -> Tenant | None:
    return session.exec(select(Tenant).where(Tenant.id == tenant_id)).first()


def assign_user_tenant(session: Session, *, user_id: int, tenant_id: str) -> User | None:
    user = session.exec(select(User).where(User.id == user_id).where(User.deleted_at.is_(None))).first()
    if not user:
        return None
    user.tenant_id = tenant_id
    user.updated_at = utc_now()
    session.add(user)
    session.flush()
    return user


def set_tenant_active(session: Session, *, tenant_id: str, is_active: bool) -> Tenant | None:
    tenant = get_tenant(session, tenant_id)
    if not tenant:
        return None
    tenant.is_active = is_active
    tenant.updated_at = utc_now()
    session.add(tenant)
    session.flush()
    return tenant


def get_refresh_token_by_hash(session: Session, token_hash: str) -> RefreshToken | None:
    return session.exec(select(RefreshToken).where(RefreshToken.token_hash == token_hash)).first()


def revoke_refresh_token(
    session: Session, token: RefreshToken, *, replaced_by_token_id: str | None = None
) -> RefreshToken:
    token.revoked_at = utc_now()
    token.replaced_by_token_id = replaced_by_token_id
    session.add(token)
    session.flush()
    return token


def get_idempotency_key(session: Session, *, endpoint: str, key: str) -> IdempotencyKey | None:
    return session.exec(
        select(IdempotencyKey)
        .where(IdempotencyKey.endpoint == endpoint)
        .where(IdempotencyKey.key == key)
    ).first()


def create_idempotency_key(
    session: Session,
    *,
    endpoint: str,
    key: str,
    request_hash: str,
    status_code: int,
    response_json: str,
) -> IdempotencyKey:
    record = IdempotencyKey(
        endpoint=endpoint,
        key=key,
        request_hash=request_hash,
        status_code=status_code,
        response_json=response_json,
    )
    session.add(record)
    session.flush()
    return record


def revoke_all_refresh_tokens_for_user(session: Session, user_id: int) -> int:
    tokens = list(
        session.exec(
            select(RefreshToken)
            .where(RefreshToken.user_id == user_id)
            .where(RefreshToken.revoked_at.is_(None))
        )
    )
    now = utc_now()
    for token in tokens:
        token.revoked_at = now
        session.add(token)
    session.flush()
    return len(tokens)


def create_refresh_token_record(
    session: Session,
    *,
    user_id: int,
    token_hash: str,
    jti: str,
    expires_at: datetime,
) -> RefreshToken:
    token = RefreshToken(
        user_id=user_id,
        token_hash=token_hash,
        jti=jti,
        expires_at=expires_at,
    )
    session.add(token)
    session.flush()
    return token
