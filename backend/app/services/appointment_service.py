from __future__ import annotations

import uuid
from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlmodel import Session

from app.core.config import settings
from app.db.models import Appointment
from app.db.repositories import (
    append_audit_log,
    append_sync_event,
    apply_server_revision,
    find_appointment_conflict,
    get_active_by_id,
    touch_for_update,
)
from app.services.rbac_service import ensure_permission


def _appointment_zone() -> ZoneInfo:
    try:
        return ZoneInfo(settings.appointment_timezone)
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def _normalize_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=_appointment_zone())
    return value.astimezone(UTC)


def _normalize_appointment_window(starts_at: datetime, ends_at: datetime) -> tuple[datetime, datetime]:
    normalized_start = _normalize_datetime(starts_at)
    normalized_end = _normalize_datetime(ends_at)
    if normalized_end <= normalized_start:
        raise ValueError("Appointment end time must be after start time.")
    return normalized_start, normalized_end


def create_appointment(
    session: Session,
    appointment: Appointment,
    device_id: str | None = None,
    actor_user_id: int | None = None,
    actor_role: str | None = None,
    tenant_id: str | None = None,
) -> Appointment:
    if actor_role is not None:
        ensure_permission("appointments:mutate", actor_role)
    appointment.tenant_id = tenant_id or "default"
    appointment.starts_at, appointment.ends_at = _normalize_appointment_window(appointment.starts_at, appointment.ends_at)

    if appointment.staff_name:
        conflict = find_appointment_conflict(
            session, appointment.staff_name, appointment.starts_at, appointment.ends_at, tenant_id=tenant_id
        )
        if conflict:
            raise ValueError("Appointment conflicts with existing staff schedule.")

    try:
        session.add(appointment)
        session.flush()
        event = append_sync_event(
            session,
            entity="Appointment",
            operation="CREATE",
            entity_id=str(appointment.id),
            payload=appointment.model_dump(mode="json"),
            operation_id=str(uuid.uuid4()),
            device_id=device_id,
            tenant_id=tenant_id or "default",
        )
        apply_server_revision(appointment, event.server_revision or 0)
        session.add(appointment)
        append_audit_log(
            session,
            action="Appointment.CREATE",
            table_name="appointments",
            record_id=str(appointment.id),
            user_id=actor_user_id,
            actor_role=actor_role,
            tenant_id=tenant_id or "default",
            payload=appointment.model_dump(mode="json"),
        )
        session.commit()
        session.refresh(appointment)
        return appointment
    except Exception:
        session.rollback()
        raise


def update_appointment(
    session: Session,
    appointment_id: str,
    changes: dict,
    device_id: str | None = None,
    actor_user_id: int | None = None,
    actor_role: str | None = None,
    tenant_id: str | None = None,
) -> Appointment:
    if actor_role is not None:
        ensure_permission("appointments:mutate", actor_role)
    appointment = get_active_by_id(session, Appointment, appointment_id, tenant_id=tenant_id)
    if not appointment:
        raise ValueError("Appointment not found.")

    incoming_start = changes.get("starts_at", appointment.starts_at)
    incoming_end = changes.get("ends_at", appointment.ends_at)
    if isinstance(incoming_start, datetime) and isinstance(incoming_end, datetime):
        normalized_start, normalized_end = _normalize_appointment_window(incoming_start, incoming_end)
        changes["starts_at"] = normalized_start
        changes["ends_at"] = normalized_end

    for field, value in changes.items():
        setattr(appointment, field, value)

    if appointment.staff_name:
        conflict = find_appointment_conflict(
            session,
            appointment.staff_name,
            appointment.starts_at,
            appointment.ends_at,
            exclude_id=str(appointment.id),
            tenant_id=tenant_id,
        )
        if conflict:
            raise ValueError("Appointment conflicts with existing staff schedule.")

    try:
        touch_for_update(appointment)
        event = append_sync_event(
            session,
            entity="Appointment",
            operation="UPDATE",
            entity_id=str(appointment.id),
            payload=changes,
            operation_id=str(uuid.uuid4()),
            device_id=device_id,
            tenant_id=tenant_id or "default",
        )
        apply_server_revision(appointment, event.server_revision or 0)
        session.add(appointment)
        append_audit_log(
            session,
            action="Appointment.UPDATE",
            table_name="appointments",
            record_id=str(appointment.id),
            user_id=actor_user_id,
            actor_role=actor_role,
            tenant_id=tenant_id or "default",
            payload=changes,
        )
        session.commit()
        session.refresh(appointment)
        return appointment
    except Exception:
        session.rollback()
        raise
