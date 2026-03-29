from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import SessionDep, get_current_user
from app.api.responses import success_response
from app.db.models import Invoice
from app.services.crud_service import delete_entity, list_entities
from app.services.invoice_service import InvoiceItemInput, create_invoice, get_invoice_detail


router = APIRouter(prefix="/invoices", tags=["invoices"], dependencies=[Depends(get_current_user)])


class InvoiceLinePayload(BaseModel):
    inventory_sku: str
    quantity: Decimal = Field(gt=0)
    unit_price_minor: int | None = None
    description: str | None = None


class InvoicePayload(BaseModel):
    invoice_number: str
    client_id: str | None = None
    currency_code: str = "SSP"
    payment_method: str
    status: str = "ISSUED"
    items: list[InvoiceLinePayload]


@router.get("")
def list_invoices(session: SessionDep):
    invoices = list_entities(session, "invoices")
    return success_response(invoices, meta={"count": len(invoices)})


@router.get("/{invoice_id}")
def get_invoice(invoice_id: str, session: SessionDep):
    try:
        return success_response(get_invoice_detail(session, invoice_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("")
def create_invoice_route(payload: InvoicePayload, session: SessionDep):
    try:
        invoice = Invoice(
            invoice_number=payload.invoice_number,
            client_id=payload.client_id,
            currency_code=payload.currency_code,
            total_minor=0,
            balance_due_minor=0,
            payment_method=payload.payment_method,
            status=payload.status,
        )
        return success_response(
            create_invoice(
                session,
                invoice,
                [InvoiceItemInput(**item.model_dump()) for item in payload.items],
            ),
            status_code=201,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/{invoice_id}")
def delete_invoice(invoice_id: str, session: SessionDep):
    try:
        return success_response(delete_entity(session, "invoices", invoice_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
