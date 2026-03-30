from __future__ import annotations

from decimal import Decimal

import pytest
from sqlmodel import select

from app.core.security import hash_password
from app.db.models import AuditLog, Client, InventoryItem, User
from app.services.crud_service import create_entity
from app.services.rbac_service import RBACError


async def _login(async_client, email: str, password: str) -> dict[str, str]:
    response = await async_client.post("/auth/login", json={"email": email, "password": password})
    response.raise_for_status()
    token = response.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_auth_me_and_cashier_route_matrix(async_client, db_session):
    cashier_user = User(
        full_name="Cashier User",
        email="cashier@pharmasync.local",
        password_hash=hash_password("Cashier123!"),
        role="cashier",
        tenant_id="default",
        is_active=True,
    )
    db_session.add(cashier_user)
    db_session.add(
        Client(
            tenant_id="default",
            client_code="CLIENT-CASHIER-1",
            full_name="Cashier Client",
            preferred_language="en",
        )
    )
    db_session.add(
        InventoryItem(
            tenant_id="default",
            sku="SKU-CASH-1",
            name="Cashier Drug",
            category="General",
            quantity_on_hand=Decimal("10"),
            reorder_level=Decimal("2"),
            unit_cost_minor=100,
            sale_price_minor=200,
        )
    )
    db_session.commit()

    cashier_headers = await _login(async_client, "cashier@pharmasync.local", "Cashier123!")
    me_response = await async_client.get("/auth/me", headers=cashier_headers)
    me_response.raise_for_status()
    me_body = me_response.json()["data"]
    assert me_body["role"] == "cashier"

    invoice_response = await async_client.post(
        "/invoices",
        headers={**cashier_headers, "Idempotency-Key": "rbac-cashier-create-1"},
        json={
            "invoice_number": "INV-RBAC-CASHIER-1",
            "client_id": db_session.exec(select(Client.id).where(Client.client_code == "CLIENT-CASHIER-1")).first(),
            "currency_code": "SSP",
            "payment_method": "CASH",
            "status": "ISSUED",
            "items": [
                {
                    "inventory_sku": "SKU-CASH-1",
                    "quantity": "1",
                }
            ],
        },
    )
    assert invoice_response.status_code == 201

    inventory_mutation = await async_client.post(
        "/inventory",
        headers=cashier_headers,
        json={
            "sku": "SKU-CASHIER-DENY",
            "name": "Denied",
            "category": "General",
            "quantity_on_hand": "1",
            "reorder_level": "0",
            "unit_cost_minor": 100,
            "sale_price_minor": 200,
        },
    )
    assert inventory_mutation.status_code == 403

    appointments_read = await async_client.get("/appointments", headers=cashier_headers)
    assert appointments_read.status_code == 403


def test_service_layer_blocks_cashier_inventory_mutation(db_session):
    with pytest.raises(RBACError):
        create_entity(
            db_session,
            "inventory",
            InventoryItem(
                tenant_id="default",
                sku="SKU-SVC-DENY-1",
                name="Denied Service",
                category="General",
                quantity_on_hand=Decimal("1"),
                reorder_level=Decimal("0"),
                unit_cost_minor=100,
                sale_price_minor=200,
            ),
            actor_user_id=1,
            actor_role="cashier",
            tenant_id="default",
        )


def test_sensitive_write_audit_contains_actor_role(db_session):
    admin = db_session.exec(select(User).where(User.email == "admin@pharmasync.local")).first()
    create_entity(
        db_session,
        "inventory",
        InventoryItem(
            tenant_id="default",
            sku="SKU-AUDIT-ROLE-1",
            name="Audit Drug",
            category="General",
            quantity_on_hand=Decimal("4"),
            reorder_level=Decimal("1"),
            unit_cost_minor=100,
            sale_price_minor=200,
        ),
        actor_user_id=admin.id if admin else None,
        actor_role=admin.role if admin else "admin",
        tenant_id="default",
    )
    log = db_session.exec(
        select(AuditLog).where(AuditLog.action == "InventoryItem.CREATE").order_by(AuditLog.id.desc())
    ).first()
    assert log is not None
    assert '"_actor"' in (log.payload_json or "")
    assert '"role": "admin"' in (log.payload_json or "")

