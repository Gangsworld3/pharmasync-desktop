from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import SessionDep, get_current_user
from app.api.responses import success_response
from app.db.models import Client
from app.services.crud_service import create_entity, delete_entity, get_entity, list_entities, update_entity


router = APIRouter(prefix="/clients", tags=["clients"], dependencies=[Depends(get_current_user)])


class ClientPayload(BaseModel):
    client_code: str
    full_name: str
    phone: str | None = None
    email: str | None = None
    preferred_language: str = "en"
    city: str | None = None
    notes: str | None = None


@router.get("")
def list_clients(session: SessionDep):
    clients = list_entities(session, "clients")
    return success_response(clients, meta={"count": len(clients)})


@router.get("/{client_id}")
def get_client(client_id: str, session: SessionDep):
    try:
        return success_response(get_entity(session, "clients", client_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("")
def create_client(payload: ClientPayload, session: SessionDep):
    return success_response(create_entity(session, "clients", Client(**payload.model_dump())), status_code=201)


@router.put("/{client_id}")
def update_client(client_id: str, payload: ClientPayload, session: SessionDep):
    try:
        return success_response(update_entity(session, "clients", client_id, payload.model_dump()))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{client_id}")
def delete_client(client_id: str, session: SessionDep):
    try:
        return success_response(delete_entity(session, "clients", client_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
