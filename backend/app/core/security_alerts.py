from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger("pharmasync.security")


def emit_security_alert(*, event: str, payload: dict[str, Any]) -> None:
    webhook_url = settings.security_alert_webhook_url
    if not webhook_url:
        return

    body = {
        "event": event,
        "timestamp": datetime.now(UTC).isoformat(),
        "service": "pharmasync-backend",
        "payload": payload,
    }
    try:
        with httpx.Client(timeout=settings.security_alert_timeout_seconds) as client:
            client.post(webhook_url, json=body)
    except Exception:  # noqa: BLE001
        logger.warning("security_alert_emit_failed", extra={"event": event})
