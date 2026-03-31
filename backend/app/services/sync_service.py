from __future__ import annotations

from typing import Any

from sqlmodel import Session


def handle_sync_push(session: Session, payload: dict[str, Any], current_user: Any | None = None) -> dict[str, Any]:
    from app.services.sync_push_service import handle_sync_push as _handle_sync_push

    return _handle_sync_push(session, payload, current_user=current_user)


def handle_sync_pull(
    session: Session,
    since: int,
    device_id: str | None = None,
    current_user: Any | None = None,
) -> dict[str, Any]:
    from app.services.sync_pull_service import handle_sync_pull as _handle_sync_pull

    return _handle_sync_pull(session, since, device_id=device_id, current_user=current_user)


__all__ = ["handle_sync_push", "handle_sync_pull"]

