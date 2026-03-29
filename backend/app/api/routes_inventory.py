from decimal import Decimal
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import SessionDep, get_current_user
from app.api.responses import success_response
from app.db.models import InventoryItem
from app.services.crud_service import create_entity, delete_entity, get_entity, list_entities, update_entity


router = APIRouter(prefix="/inventory", tags=["inventory"], dependencies=[Depends(get_current_user)])


class InventoryPayload(BaseModel):
    sku: str
    name: str
    category: str
    quantity_on_hand: Decimal = Decimal("0")
    reorder_level: Decimal = Decimal("0")
    unit_cost_minor: int = 0
    sale_price_minor: int = 0
    batch_number: str | None = None
    expires_on: datetime | None = None


@router.get("")
def list_inventory(session: SessionDep):
    inventory = list_entities(session, "inventory")
    return success_response(inventory, meta={"count": len(inventory)})


@router.get("/{item_id}")
def get_inventory_item(item_id: str, session: SessionDep):
    try:
        return success_response(get_entity(session, "inventory", item_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("")
def create_inventory_item(payload: InventoryPayload, session: SessionDep):
    return success_response(create_entity(session, "inventory", InventoryItem(**payload.model_dump())), status_code=201)


@router.put("/{item_id}")
def update_inventory_item(item_id: str, payload: InventoryPayload, session: SessionDep):
    try:
        return success_response(update_entity(session, "inventory", item_id, payload.model_dump()))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{item_id}")
def delete_inventory_item(item_id: str, session: SessionDep):
    try:
        return success_response(delete_entity(session, "inventory", item_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
