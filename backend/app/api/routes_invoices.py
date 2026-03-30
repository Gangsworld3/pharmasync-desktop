import hashlib
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Header
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.api.deps import SessionDep, get_current_user, require_role
from app.api.responses import success_response
from app.db.models import Invoice, User
from app.db.repositories import create_idempotency_key, get_idempotency_key
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
def list_invoices(
    session: SessionDep,
    current_user: User = Depends(require_role("admin", "pharmacist", "cashier")),
):
    invoices = list_entities(session, "invoices", tenant_id=current_user.tenant_id)
    return success_response(invoices, meta={"count": len(invoices)})


@router.get("/{invoice_id}")
def get_invoice(
    invoice_id: str,
    session: SessionDep,
    current_user: User = Depends(require_role("admin", "pharmacist", "cashier")),
):
    try:
        return success_response(get_invoice_detail(session, invoice_id, tenant_id=current_user.tenant_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("")
def create_invoice_route(
    payload: InvoicePayload,
    session: SessionDep,
    current_user: User = Depends(require_role("admin", "pharmacist", "cashier")),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    try:
        endpoint = "POST:/invoices"
        request_hash = hashlib.sha256(payload.model_dump_json().encode()).hexdigest()
        if idempotency_key:
            # Serialize same-key requests in the database so replay is safe under concurrency.
            session.exec(
                text("SELECT pg_advisory_xact_lock(hashtext(:lock_key))"),
                params={"lock_key": f"{endpoint}:{idempotency_key}"},
            )
            existing = get_idempotency_key(session, endpoint=endpoint, key=idempotency_key)
            if existing:
                if existing.request_hash != request_hash:
                    raise HTTPException(
                        status_code=409,
                        detail="Idempotency-Key reused with different payload.",
                    )
                return Response(
                    content=existing.response_json,
                    status_code=existing.status_code,
                    media_type="application/json",
                )

        invoice = Invoice(
            invoice_number=payload.invoice_number,
            client_id=payload.client_id,
            currency_code=payload.currency_code,
            total_minor=0,
            balance_due_minor=0,
            payment_method=payload.payment_method,
            status=payload.status,
        )
        items = [InvoiceItemInput(**item.model_dump()) for item in payload.items]

        if not idempotency_key:
            return success_response(
                create_invoice(
                    session,
                    invoice,
                items,
                actor_user_id=current_user.id,
                actor_role=current_user.role,
                tenant_id=current_user.tenant_id,
            ),
            status_code=201,
        )

        created = create_invoice(
            session,
            invoice,
            items,
            actor_user_id=current_user.id,
            actor_role=current_user.role,
            tenant_id=current_user.tenant_id,
            auto_commit=False,
        )
        response = success_response(created, status_code=201)
        create_idempotency_key(
            session,
            endpoint=endpoint,
            key=idempotency_key,
            request_hash=request_hash,
            status_code=response.status_code,
            response_json=response.body.decode(),
        )
        session.commit()
        return response
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except IntegrityError:
        session.rollback()
        if idempotency_key:
            existing = get_idempotency_key(session, endpoint=endpoint, key=idempotency_key)
            if existing and existing.request_hash == request_hash:
                return Response(
                    content=existing.response_json,
                    status_code=existing.status_code,
                    media_type="application/json",
                )
        raise HTTPException(status_code=409, detail="Request could not be applied safely.")


@router.delete("/{invoice_id}")
def delete_invoice(
    invoice_id: str,
    session: SessionDep,
    current_user: User = Depends(require_role("admin")),
):
    try:
        return success_response(
            delete_entity(
                session,
                "invoices",
                invoice_id,
                actor_user_id=current_user.id,
                actor_role=current_user.role,
                tenant_id=current_user.tenant_id,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
