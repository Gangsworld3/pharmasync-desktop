from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import SessionDep, get_current_user, require_role
from app.db.models import User
from app.api.responses import success_response
from app.db.repos import list_conflicts, resolve_conflict


router = APIRouter(prefix="/conflicts", tags=["conflicts"], dependencies=[Depends(get_current_user)])


@router.get("")
def get_conflicts(
    session: SessionDep,
    resolved: bool | None = None,
    current_user: User = Depends(require_role("admin", "pharmacist")),
):
    conflicts = list_conflicts(session, tenant_id=current_user.tenant_id, resolved=resolved)
    return success_response(conflicts, meta={"count": len(conflicts)})


@router.post("/{conflict_id}/resolve")
def resolve_conflict_route(
    conflict_id: str,
    session: SessionDep,
    current_user: User = Depends(require_role("admin", "pharmacist")),
):
    conflict = resolve_conflict(session, conflict_id, tenant_id=current_user.tenant_id)
    if not conflict:
        raise HTTPException(status_code=404, detail="Conflict not found.")
    return success_response(conflict)
