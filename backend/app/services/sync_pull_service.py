from __future__ import annotations

import json

from sqlmodel import Session

from app.db.repositories import list_sync_events_since


def handle_sync_pull(session: Session, since: int) -> dict[str, object]:
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
    return {"newRevision": new_revision, "serverChanges": changes}
