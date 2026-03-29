from __future__ import annotations

import hashlib
import hmac
import json
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

from sqlmodel import Session

from app.core.config import settings
from app.db.models import SyncEvent
from app.db.repositories import list_sync_event_audit_since, list_sync_events_since


def _hash_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _compute_event_hash(
    *,
    server_revision: int,
    operation_id: str,
    entity: str,
    operation: str,
    entity_id: str,
    payload_hash: str,
    previous_event_hash: str | None,
) -> str:
    previous_hash = previous_event_hash or "GENESIS"
    canonical = "|".join(
        [
            str(server_revision),
            operation_id,
            entity,
            operation,
            entity_id,
            payload_hash,
            previous_hash,
        ]
    )
    return _hash_hex(canonical)


def replay_sync_audit(
    session: Session,
    *,
    since_revision: int = 0,
    upto_revision: int | None = None,
) -> dict[str, Any]:
    events = list_sync_events_since(session, since_revision)
    audits = list_sync_event_audit_since(session, since_revision)

    if upto_revision is not None:
        events = [event for event in events if (event.server_revision or 0) <= upto_revision]
        audits = [audit for audit in audits if (audit.server_revision or 0) <= upto_revision]

    audit_by_revision = {audit.server_revision: audit for audit in audits}
    entity_operation_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    anomalies: list[dict[str, Any]] = []
    previous_hash = None
    replay_digest = None

    for expected_index, event in enumerate(events, start=1):
        revision = event.server_revision or 0
        expected_revision = since_revision + expected_index
        if revision != expected_revision:
            anomalies.append(
                {
                    "type": "REVISION_GAP",
                    "expected_revision": expected_revision,
                    "actual_revision": revision,
                }
            )

        audit = audit_by_revision.get(revision)
        if not audit:
            anomalies.append({"type": "MISSING_AUDIT_ROW", "revision": revision})
            continue

        payload_hash = _hash_hex(event.payload_json)
        if payload_hash != audit.payload_hash:
            anomalies.append(
                {
                    "type": "PAYLOAD_HASH_MISMATCH",
                    "revision": revision,
                    "expected_payload_hash": payload_hash,
                    "stored_payload_hash": audit.payload_hash,
                }
            )

        computed_hash = _compute_event_hash(
            server_revision=revision,
            operation_id=event.operation_id,
            entity=event.entity,
            operation=event.operation,
            entity_id=event.entity_id,
            payload_hash=payload_hash,
            previous_event_hash=previous_hash,
        )
        if computed_hash != audit.event_hash:
            anomalies.append(
                {
                    "type": "EVENT_HASH_MISMATCH",
                    "revision": revision,
                    "expected_event_hash": computed_hash,
                    "stored_event_hash": audit.event_hash,
                }
            )

        if audit.previous_event_hash != previous_hash:
            anomalies.append(
                {
                    "type": "CHAIN_LINK_MISMATCH",
                    "revision": revision,
                    "expected_previous_hash": previous_hash,
                    "stored_previous_hash": audit.previous_event_hash,
                }
            )

        previous_hash = audit.event_hash
        entity_operation_counts[event.entity][event.operation] += 1
        replay_digest = _hash_hex("|".join([replay_digest or "GENESIS", audit.event_hash]))

    max_revision = max((event.server_revision or 0 for event in events), default=since_revision)
    return {
        "chain_valid": len(anomalies) == 0,
        "since_revision": since_revision,
        "upto_revision": upto_revision if upto_revision is not None else max_revision,
        "event_count": len(events),
        "anomaly_count": len(anomalies),
        "anomalies": anomalies,
        "entity_operation_counts": {entity: dict(operations) for entity, operations in entity_operation_counts.items()},
        "replay_digest": replay_digest or "GENESIS",
    }


def _signature_secret() -> str:
    return settings.sync_audit_hmac_secret or settings.jwt_secret


def _canonical_report_json(report: dict[str, Any]) -> str:
    return json.dumps(report, sort_keys=True, separators=(",", ":"), default=str)


def sign_sync_audit_report(report: dict[str, Any]) -> dict[str, Any]:
    signed_at = datetime.now(UTC).isoformat()
    canonical = f"{signed_at}|{_canonical_report_json(report)}"
    signature = hmac.new(_signature_secret().encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()
    return {
        "algorithm": "hmac-sha256",
        "signed_at": signed_at,
        "signature": signature,
    }


def export_sync_audit_snapshot(
    session: Session,
    *,
    since_revision: int = 0,
    upto_revision: int | None = None,
    include_events: bool = True,
) -> dict[str, Any]:
    report = replay_sync_audit(session, since_revision=since_revision, upto_revision=upto_revision)
    signature = sign_sync_audit_report(report)

    payload: dict[str, Any] = {
        "snapshot_type": "sync_audit_snapshot",
        "report": report,
        "signature": signature,
    }

    if include_events:
        events = list_sync_events_since(session, since_revision)
        audits = list_sync_event_audit_since(session, since_revision)
        effective_upto = report["upto_revision"]
        payload["events"] = [
            {
                "server_revision": event.server_revision,
                "entity": event.entity,
                "operation": event.operation,
                "entity_id": event.entity_id,
                "operation_id": event.operation_id,
                "payload_json": event.payload_json,
                "device_id": event.device_id,
                "resolution_type": event.resolution_type,
                "resolved": event.resolved,
                "created_at": event.created_at.isoformat() if event.created_at else None,
            }
            for event in events
            if (event.server_revision or 0) <= effective_upto
        ]
        payload["event_audit_chain"] = [
            {
                "server_revision": audit.server_revision,
                "operation_id": audit.operation_id,
                "payload_hash": audit.payload_hash,
                "previous_event_hash": audit.previous_event_hash,
                "event_hash": audit.event_hash,
                "hash_algorithm": audit.hash_algorithm,
                "created_at": audit.created_at.isoformat() if audit.created_at else None,
            }
            for audit in audits
            if (audit.server_revision or 0) <= effective_upto
        ]

    return payload
