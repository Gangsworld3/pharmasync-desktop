from __future__ import annotations

import uuid
from typing import Any

from sqlmodel import Session

from app.db.models import Appointment, Client, InventoryItem, Invoice, MessageEvent
from app.db.repositories import (
    RESOURCE_MODELS,
    append_audit_log,
    append_sync_event,
    apply_server_revision,
    get_active_by_id,
    list_active,
    mark_deleted,
    touch_for_update,
)


MODEL_MAP = {
    "clients": Client,
    "inventory": InventoryItem,
    "appointments": Appointment,
    "messages": MessageEvent,
    "invoices": Invoice,
}


def list_entities(session: Session, resource: str) -> list[Any]:
    return list_active(session, MODEL_MAP[resource])


def get_entity(session: Session, resource: str, entity_id: str) -> Any:
    entity = get_active_by_id(session, MODEL_MAP[resource], entity_id)
    if not entity:
        raise ValueError(f"{resource[:-1].title()} not found.")
    return entity


def create_entity(
    session: Session,
    resource: str,
    entity: Any,
    device_id: str | None = None,
    actor_user_id: int | None = None,
) -> Any:
    try:
        session.add(entity)
        session.flush()
        event = append_sync_event(
            session,
            entity=entity.__class__.__name__,
            operation="CREATE",
            entity_id=str(entity.id),
            payload=entity.model_dump(mode="json"),
            operation_id=str(uuid.uuid4()),
            device_id=device_id,
        )
        apply_server_revision(entity, event.server_revision or 0)
        session.add(entity)
        append_audit_log(
            session,
            action=f"{entity.__class__.__name__}.CREATE",
            table_name=entity.__class__.__tablename__,
            record_id=str(entity.id),
            user_id=actor_user_id,
            payload=entity.model_dump(mode="json"),
        )
        session.commit()
        session.refresh(entity)
        return entity
    except Exception:
        session.rollback()
        raise


def update_entity(
    session: Session,
    resource: str,
    entity_id: str,
    changes: dict[str, Any],
    device_id: str | None = None,
    actor_user_id: int | None = None,
) -> Any:
    entity = get_entity(session, resource, entity_id)
    try:
        for field, value in changes.items():
            setattr(entity, field, value)
        touch_for_update(entity)
        event = append_sync_event(
            session,
            entity=entity.__class__.__name__,
            operation="UPDATE",
            entity_id=str(entity.id),
            payload=changes,
            operation_id=str(uuid.uuid4()),
            device_id=device_id,
        )
        apply_server_revision(entity, event.server_revision or 0)
        session.add(entity)
        append_audit_log(
            session,
            action=f"{entity.__class__.__name__}.UPDATE",
            table_name=entity.__class__.__tablename__,
            record_id=str(entity.id),
            user_id=actor_user_id,
            payload=changes,
        )
        session.commit()
        session.refresh(entity)
        return entity
    except Exception:
        session.rollback()
        raise


def delete_entity(
    session: Session,
    resource: str,
    entity_id: str,
    device_id: str | None = None,
    actor_user_id: int | None = None,
) -> Any:
    entity = mark_deleted(get_entity(session, resource, entity_id))
    try:
        event = append_sync_event(
            session,
            entity=entity.__class__.__name__,
            operation="DELETE",
            entity_id=str(entity.id),
            payload={"deleted_at": str(entity.deleted_at)},
            operation_id=str(uuid.uuid4()),
            device_id=device_id,
        )
        apply_server_revision(entity, event.server_revision or 0)
        session.add(entity)
        append_audit_log(
            session,
            action=f"{entity.__class__.__name__}.DELETE",
            table_name=entity.__class__.__tablename__,
            record_id=str(entity.id),
            user_id=actor_user_id,
            payload={"deleted_at": str(entity.deleted_at)},
        )
        session.commit()
        session.refresh(entity)
        return entity
    except Exception:
        session.rollback()
        raise
