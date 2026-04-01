from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any


def is_valid_utc_iso_datetime_string(value: str) -> bool:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    if parsed.tzinfo is None:
        return False
    if parsed.utcoffset() != timedelta(0):
        return False
    return value.endswith("Z") or value.endswith("+00:00")


def parse_crdt_meta(change: dict[str, Any]) -> tuple[list[str], dict[str, int]]:
    raw_data = change.get("data", {})
    raw_crdt = raw_data.get("_crdt") if isinstance(raw_data, dict) else None
    if not isinstance(raw_crdt, dict):
        return [], {}

    raw_changed_fields = raw_crdt.get("changedFields", [])
    changed_fields = [str(field) for field in raw_changed_fields if isinstance(field, str)]
    raw_field_clocks = raw_crdt.get("fieldClocks", {})
    field_clocks: dict[str, int] = {}
    if isinstance(raw_field_clocks, dict):
        for field_name, clock in raw_field_clocks.items():
            if isinstance(field_name, str):
                try:
                    field_clocks[field_name] = max(0, int(clock))
                except (TypeError, ValueError):
                    continue
    return changed_fields, field_clocks


def parse_invoice_items(data: dict[str, Any], *, invoice_item_input_cls: Any) -> list[Any]:
    parsed_items: list[Any] = []
    for item in data.get("items", []):
        inventory_sku = item.get("inventory_sku") or item.get("sku")
        quantity = item.get("quantity", item.get("qty"))
        parsed_items.append(
            invoice_item_input_cls(
                inventory_sku=inventory_sku,
                quantity=Decimal(str(quantity)),
                unit_price_minor=item.get("unit_price_minor"),
                description=item.get("description"),
            )
        )
    return parsed_items


def validate_change(change: dict[str, Any], *, sync_entity_models: dict[str, Any]) -> None:
    if not change.get("operationId"):
        raise ValueError("Missing operationId.")
    if change.get("entity") not in sync_entity_models:
        raise ValueError(f"Unsupported entity: {change.get('entity')}.")
    if change.get("operation", "").upper() not in {"CREATE", "UPDATE", "DELETE"}:
        raise ValueError(f"Unsupported operation: {change.get('operation')}.")
    if not change.get("entityId"):
        raise ValueError("Missing entityId.")
    if change.get("entity") == "Message" and change.get("operation", "").upper() != "CREATE":
        raise ValueError("Messages are append-only and only support CREATE.")
    if change.get("entity") == "Appointment" and change.get("operation", "").upper() in {"CREATE", "UPDATE"}:
        payload_data = change.get("data", {})
        if isinstance(payload_data, dict):
            for field in ("starts_at", "ends_at"):
                if field not in payload_data:
                    continue
                value = payload_data[field]
                if not isinstance(value, str) or not is_valid_utc_iso_datetime_string(value):
                    raise ValueError(
                        f"Invalid {field}. Appointment sync payloads must use UTC ISO timestamps "
                        "(e.g. 2026-04-01T09:00:00Z)."
                    )
