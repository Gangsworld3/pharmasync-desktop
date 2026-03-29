from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any, Type

from sqlmodel import Session, select

from app.db.models import (
    Appointment,
    AuditLog,
    Client,
    ConflictQueue,
    IdempotencyKey,
    InventoryItem,
    Invoice,
    InvoiceLineItem,
    Message,
    MessageEvent,
    RefreshToken,
    ServerState,
    SyncEvent,
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


def utc_now() -> datetime:
    return datetime.now(UTC)


def list_active(session: Session, model: Type[Any]) -> list[Any]:
    query = select(model)
    if hasattr(model, "deleted_at"):
        query = query.where(model.deleted_at.is_(None))
    if hasattr(model, "server_revision"):
        query = query.order_by(model.server_revision)
    elif hasattr(model, "created_at"):
        query = query.order_by(model.created_at)
    return list(session.exec(query))


def get_active_by_id(session: Session, model: Type[Any], entity_id: Any) -> Any | None:
    query = select(model).where(model.id == entity_id)
    if hasattr(model, "deleted_at"):
        query = query.where(model.deleted_at.is_(None))
    return session.exec(query).first()


def get_user_by_email(session: Session, email: str) -> User | None:
    return session.exec(select(User).where(User.email == email).where(User.deleted_at.is_(None))).first()


def get_inventory_by_sku(session: Session, sku: str) -> InventoryItem | None:
    return session.exec(
        select(InventoryItem).where(InventoryItem.sku == sku).where(InventoryItem.deleted_at.is_(None))
    ).first()


def get_inventory_by_sku_for_update(session: Session, sku: str) -> InventoryItem | None:
    return session.exec(
        select(InventoryItem)
        .where(InventoryItem.sku == sku)
        .where(InventoryItem.deleted_at.is_(None))
        .with_for_update()
    ).first()


def list_invoice_items(session: Session, invoice_id: str) -> list[InvoiceLineItem]:
    return list(
        session.exec(
            select(InvoiceLineItem)
            .where(InvoiceLineItem.invoice_id == invoice_id)
            .where(InvoiceLineItem.deleted_at.is_(None))
        )
    )


def find_appointment_conflict(
    session: Session, staff_name: str, starts_at: datetime, ends_at: datetime, exclude_id: str | None = None
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
    event = SyncEvent(
        server_revision=state.current_revision,
        entity=entity,
        operation=operation,
        entity_id=entity_id,
        payload_json=json.dumps(payload, default=str),
        operation_id=operation_id,
        device_id=device_id,
        resolution_type=resolution_type,
        resolved=resolved,
    )
    session.add(state)
    session.add(event)
    session.flush()
    return event


def get_sync_event_by_operation_id(session: Session, operation_id: str) -> SyncEvent | None:
    return session.exec(select(SyncEvent).where(SyncEvent.operation_id == operation_id)).first()


def apply_server_revision(entity: Any, server_revision: int) -> Any:
    entity.server_revision = server_revision
    if hasattr(entity, "updated_at"):
        entity.updated_at = utc_now()
    return entity


def latest_server_revision(session: Session) -> int:
    event = session.exec(select(SyncEvent).order_by(SyncEvent.server_revision.desc())).first()
    return event.server_revision if event and event.server_revision else 0


def list_sync_events_since(session: Session, since: int) -> list[SyncEvent]:
    return list(session.exec(select(SyncEvent).where(SyncEvent.server_revision > since).order_by(SyncEvent.server_revision)))


def get_conflict_by_operation_id(session: Session, operation_id: str) -> ConflictQueue | None:
    return session.exec(select(ConflictQueue).where(ConflictQueue.operation_id == operation_id)).first()


def enqueue_conflict(
    session: Session,
    *,
    operation_id: str,
    entity_type: str,
    entity_id: str,
    conflict_type: str,
    payload: dict[str, Any],
    requires_user_action: bool = True,
) -> ConflictQueue:
    existing = get_conflict_by_operation_id(session, operation_id)
    if existing:
        return existing

    conflict = ConflictQueue(
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


def list_conflicts(session: Session, *, resolved: bool | None = None) -> list[ConflictQueue]:
    query = select(ConflictQueue)
    if resolved is not None:
        query = query.where(ConflictQueue.resolved == resolved)
    query = query.order_by(ConflictQueue.created_at.desc())
    return list(session.exec(query))


def resolve_conflict(session: Session, conflict_id: str) -> ConflictQueue | None:
    conflict = session.get(ConflictQueue, conflict_id)
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
    payload: dict[str, Any] | None = None,
) -> AuditLog:
    log = AuditLog(
        user_id=user_id,
        action=action,
        table_name=table_name,
        record_id=record_id,
        payload_json=json.dumps(payload, default=str) if payload is not None else None,
    )
    session.add(log)
    session.flush()
    return log


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
