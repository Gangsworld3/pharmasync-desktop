from __future__ import annotations

import json

from sqlmodel import Session

from app.db.repositories import advance_device_cursor, ensure_monotonic_device_cursor, list_sync_events_since


def handle_sync_pull(session: Session, since: int, device_id: str | None = None) -> dict[str, object]:
    if device_id:
        ensure_monotonic_device_cursor(
            session,
            device_id=device_id,
            incoming_revision=since,
            direction="pull",
        )

    changes = [
        {
            "serverRevision": event.server_revision,
            "entity": event.entity,
            "operation": event.operation,
            "entityId": event.entity_id,
            "data": json.loads(event.payload_json),
        }
        for event in list_sync_events_since(session, since)
    ]
    new_revision = changes[-1]["serverRevision"] if changes else since

    if device_id:
        advance_device_cursor(
            session,
            device_id=device_id,
            revision=new_revision,
            direction="pull",
        )
        session.commit()
    return {"newRevision": new_revision, "serverChanges": changes}
