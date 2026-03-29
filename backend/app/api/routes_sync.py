from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import SessionDep, get_current_user
from app.api.responses import success_response
from app.services.sync_service import handle_sync_pull, handle_sync_push


router = APIRouter(prefix="/sync", tags=["sync"], dependencies=[Depends(get_current_user)])


class SyncChange(BaseModel):
    operationId: str
    entity: str
    operation: str
    entityId: str
    localRevision: int
    data: dict


class SyncPushPayload(BaseModel):
    deviceId: str
    lastPulledRevision: int = 0
    changes: list[SyncChange]


@router.post("/push")
def sync_push(payload: SyncPushPayload, session: SessionDep):
    try:
        result = handle_sync_push(session, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return success_response(
        {
            "applied": result["applied"],
            "conflicts": result["conflicts"],
            "serverChanges": result["serverChanges"],
            "results": result["results"],
        },
        meta={"revision": result["newRevision"]},
    )


@router.get("/pull")
def sync_pull(since: int, session: SessionDep):
    result = handle_sync_pull(session, since)
    return success_response(
        {"serverChanges": result["serverChanges"]},
        meta={"revision": result["newRevision"]},
    )
