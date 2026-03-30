from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import SessionDep, get_current_user, require_role
from app.api.responses import success_response
from app.db.models import User
from app.services.analytics_service import (
    analytics_daily_sales,
    analytics_expiry_loss,
    analytics_top_medicines,
)


router = APIRouter(prefix="/analytics", tags=["analytics"], dependencies=[Depends(get_current_user)])


@router.get("/daily-sales")
def get_daily_sales(
    session: SessionDep,
    from_date: str = Query(alias="from"),
    to_date: str = Query(alias="to"),
    current_user: User = Depends(require_role("admin", "pharmacist", "cashier")),
):
    try:
        rows = analytics_daily_sales(session, from_date, to_date, tenant_id=current_user.tenant_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return success_response(rows, meta={"count": len(rows)})


@router.get("/top-medicines")
def get_top_medicines(
    session: SessionDep,
    from_date: str = Query(alias="from"),
    to_date: str = Query(alias="to"),
    limit: int = Query(default=10, ge=1, le=100),
    current_user: User = Depends(require_role("admin", "pharmacist", "cashier")),
):
    try:
        rows = analytics_top_medicines(
            session,
            from_date,
            to_date,
            limit=limit,
            tenant_id=current_user.tenant_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return success_response(rows, meta={"count": len(rows)})


@router.get("/expiry-loss")
def get_expiry_loss(
    session: SessionDep,
    days: int = Query(default=30, ge=1, le=365),
    current_user: User = Depends(require_role("admin", "pharmacist", "cashier")),
):
    try:
        payload = analytics_expiry_loss(session, days=days, tenant_id=current_user.tenant_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return success_response(payload)
