from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import SessionDep, get_current_user
from app.api.responses import success_response
from app.db.repositories import list_conflicts, resolve_conflict


router = APIRouter(prefix="/conflicts", tags=["conflicts"], dependencies=[Depends(get_current_user)])


@router.get("")
def get_conflicts(session: SessionDep, resolved: bool | None = None):
    conflicts = list_conflicts(session, resolved=resolved)
    return success_response(conflicts, meta={"count": len(conflicts)})


@router.post("/{conflict_id}/resolve")
def resolve_conflict_route(conflict_id: str, session: SessionDep):
    conflict = resolve_conflict(session, conflict_id)
    if not conflict:
        raise HTTPException(status_code=404, detail="Conflict not found.")
    return success_response(conflict)
