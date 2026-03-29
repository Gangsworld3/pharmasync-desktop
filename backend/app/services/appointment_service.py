from __future__ import annotations

import uuid

from sqlmodel import Session

from app.db.models import Appointment
from app.db.repositories import (
    append_sync_event,
    apply_server_revision,
    find_appointment_conflict,
    get_active_by_id,
    touch_for_update,
)


def create_appointment(session: Session, appointment: Appointment, device_id: str | None = None) -> Appointment:
    if appointment.staff_name:
        conflict = find_appointment_conflict(
            session, appointment.staff_name, appointment.starts_at, appointment.ends_at
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
        )
        apply_server_revision(appointment, event.server_revision or 0)
        session.add(appointment)
        session.commit()
        session.refresh(appointment)
        return appointment
    except Exception:
        session.rollback()
        raise


def update_appointment(session: Session, appointment_id: str, changes: dict, device_id: str | None = None) -> Appointment:
    appointment = get_active_by_id(session, Appointment, appointment_id)
    if not appointment:
        raise ValueError("Appointment not found.")

    for field, value in changes.items():
        setattr(appointment, field, value)

    if appointment.staff_name:
        conflict = find_appointment_conflict(
            session,
            appointment.staff_name,
            appointment.starts_at,
            appointment.ends_at,
            exclude_id=str(appointment.id),
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
        )
        apply_server_revision(appointment, event.server_revision or 0)
        session.add(appointment)
        session.commit()
        session.refresh(appointment)
        return appointment
    except Exception:
        session.rollback()
        raise
