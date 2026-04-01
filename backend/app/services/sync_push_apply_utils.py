from __future__ import annotations

from typing import Any, Callable

from sqlmodel import Session


def conflict_payload(
    conflict_type: str,
    entity_name: str,
    entity_id: str,
    change: dict[str, Any],
    server: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = {
        "type": conflict_type,
        "entity": entity_name,
        "entityId": entity_id,
        "local": change,
        "resolution": "REQUIRES_USER_ACTION",
    }
    if server is not None:
        payload["server"] = server
    return payload


def append_applied_result(
    *,
    applied: list[dict[str, Any]],
    results: list[dict[str, Any]],
    operation_id: str,
    entity_name: str,
    entity_id: str,
    server_revision: int,
    resolution: str | None = None,
    merged_fields: dict[str, Any] | None = None,
    skipped_fields: list[str] | None = None,
) -> None:
    applied.append({"entity": entity_name, "entityId": entity_id, "serverRevision": server_revision})
    result: dict[str, Any] = {
        "operationId": operation_id,
        "entity": entity_name,
        "entityId": entity_id,
        "status": "APPLIED",
    }
    if resolution:
        result["resolution"] = resolution
    if merged_fields is not None:
        result["mergedFields"] = merged_fields
    if skipped_fields is not None:
        result["skippedFields"] = skipped_fields
    results.append(result)


def enqueue_and_append_conflict(
    *,
    session: Session,
    conflicts: list[dict[str, Any]],
    results: list[dict[str, Any]],
    operation_id: str,
    entity_name: str,
    entity_id: str,
    conflict_type: str,
    payload: dict[str, Any],
    tenant_id: str,
    enqueue_conflict_fn: Callable[..., Any],
    resolution: str = "REQUIRES_USER_ACTION",
    result_status: str = "CONFLICT",
) -> None:
    enqueue_conflict_fn(
        session,
        operation_id=operation_id,
        entity_type=entity_name,
        entity_id=entity_id,
        conflict_type=conflict_type,
        payload=payload,
        tenant_id=tenant_id,
    )
    conflicts.append(payload)
    results.append(
        {
            "operationId": operation_id,
            "entity": entity_name,
            "entityId": entity_id,
            "status": result_status,
            "resolution": resolution,
        }
    )
