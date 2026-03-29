from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import SessionDep, get_current_user, require_role
from app.api.responses import success_response
from app.db.models import Appointment, User
from app.services.appointment_service import create_appointment, update_appointment
from app.services.crud_service import delete_entity, get_entity, list_entities


router = APIRouter(prefix="/appointments", tags=["appointments"], dependencies=[Depends(get_current_user)])


class AppointmentPayload(BaseModel):
    client_id: str
    service_type: str
    staff_name: str | None = None
    starts_at: datetime
    ends_at: datetime
    status: str = "PENDING"
    notes: str | None = None


@router.get("")
def list_appointments(session: SessionDep):
    appointments = list_entities(session, "appointments")
    return success_response(appointments, meta={"count": len(appointments)})


@router.get("/{appointment_id}")
def get_appointment(appointment_id: str, session: SessionDep):
    try:
        return success_response(get_entity(session, "appointments", appointment_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("")
def create_appointment_route(
    payload: AppointmentPayload,
    session: SessionDep,
    current_user: User = Depends(require_role("admin", "pharmacist")),
):
    try:
        return success_response(
            create_appointment(
                session,
                Appointment(**payload.model_dump()),
                actor_user_id=current_user.id,
            ),
            status_code=201,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.put("/{appointment_id}")
def update_appointment_route(
    appointment_id: str,
    payload: AppointmentPayload,
    session: SessionDep,
    current_user: User = Depends(require_role("admin", "pharmacist")),
):
    try:
        return success_response(
            update_appointment(
                session,
                appointment_id,
                payload.model_dump(),
                actor_user_id=current_user.id,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/{appointment_id}")
def delete_appointment(
    appointment_id: str,
    session: SessionDep,
    current_user: User = Depends(require_role("admin")),
):
    try:
        return success_response(
            delete_entity(session, "appointments", appointment_id, actor_user_id=current_user.id)
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
