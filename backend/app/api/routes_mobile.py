from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query

from app.api.deps import SessionDep, get_current_user, require_role
from app.api.responses import success_response
from app.db.models import User
from app.services.crud_service import list_entities


router = APIRouter(prefix="/mobile", tags=["mobile"], dependencies=[Depends(get_current_user)])


@router.get("/stock")
def mobile_stock_check(
    session: SessionDep,
    query: str | None = None,
    limit: int = Query(default=50, ge=1, le=500),
    current_user: User = Depends(require_role("admin", "pharmacist", "cashier")),
):
    items = list_entities(session, "inventory", tenant_id=current_user.tenant_id)
    search = (query or "").strip().lower()
    if search:
        items = [
            item for item in items
            if search in item.name.lower() or search in item.sku.lower()
        ]
    return success_response(items[:limit], meta={"count": len(items[:limit])})


@router.get("/alerts/expiry")
def mobile_expiry_alerts(
    session: SessionDep,
    days: int = Query(default=30, ge=1, le=365),
    current_user: User = Depends(require_role("admin", "pharmacist", "cashier")),
):
    now = datetime.now(UTC)
    cutoff = now + timedelta(days=days)
    items = list_entities(session, "inventory", tenant_id=current_user.tenant_id)
    alerts = [
        {
            "inventory_item_id": item.id,
            "sku": item.sku,
            "name": item.name,
            "expires_on": item.expires_on.isoformat() if item.expires_on else None,
            "quantity_on_hand": str(item.quantity_on_hand),
        }
        for item in items
        if item.expires_on and now <= item.expires_on <= cutoff
    ]
    return success_response(alerts, meta={"count": len(alerts), "window_days": days})


@router.get("/alerts/low-stock")
def mobile_low_stock_alerts(
    session: SessionDep,
    current_user: User = Depends(require_role("admin", "pharmacist", "cashier")),
):
    items = list_entities(session, "inventory", tenant_id=current_user.tenant_id)
    alerts = [
        {
            "inventory_item_id": item.id,
            "sku": item.sku,
            "name": item.name,
            "quantity_on_hand": str(item.quantity_on_hand),
            "reorder_level": str(item.reorder_level),
        }
        for item in items
        if item.quantity_on_hand <= item.reorder_level
    ]
    return success_response(alerts, meta={"count": len(alerts)})

