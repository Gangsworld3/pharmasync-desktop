from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import SessionDep, get_current_user
from app.api.responses import success_response
from app.db.models import MessageEvent
from app.services.crud_service import create_entity, get_entity, list_entities


router = APIRouter(prefix="/messages", tags=["messages"], dependencies=[Depends(get_current_user)])


class MessagePayload(BaseModel):
    conversation_id: str
    sender_id: str
    content: str


@router.get("")
def list_messages(session: SessionDep):
    messages = list_entities(session, "messages")
    return success_response(messages, meta={"count": len(messages)})


@router.get("/{message_id}")
def get_message(message_id: str, session: SessionDep):
    try:
        return success_response(get_entity(session, "messages", message_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("")
def create_message(payload: MessagePayload, session: SessionDep):
    return success_response(create_entity(session, "messages", MessageEvent(**payload.model_dump())), status_code=201)
