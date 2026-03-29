from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from app.db.models import AuditLog, InventoryItem
from app.services.crud_service import create_entity


def test_inventory_create_writes_audit_log(db_session):
    item = InventoryItem(
        sku="AUDIT-001",
        name="Audit Sample Drug",
        category="test",
        quantity_on_hand=Decimal("10"),
        reorder_level=Decimal("2"),
        unit_cost_minor=1000,
        sale_price_minor=1500,
    )

    create_entity(db_session, "inventory", item, actor_user_id=1)

    logs = list(
        db_session.exec(
            select(AuditLog).where(AuditLog.table_name == "inventory_items").where(AuditLog.record_id == item.id)
        )
    )
    assert len(logs) == 1
    assert logs[0].action == "InventoryItem.CREATE"
    assert logs[0].user_id == 1


def test_inventory_non_negative_constraint(db_session):
    item = InventoryItem(
        sku="NEG-001",
        name="Invalid Stock Item",
        category="test",
        quantity_on_hand=Decimal("-1"),
        reorder_level=Decimal("0"),
        unit_cost_minor=100,
        sale_price_minor=200,
    )

    with pytest.raises(IntegrityError):
        create_entity(db_session, "inventory", item, actor_user_id=1)
