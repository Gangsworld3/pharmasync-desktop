from __future__ import annotations

from sqlalchemy import text
import pytest
from sqlmodel import select

from app.core.security import hash_password
from app.db.models import SyncEvent, SyncEventAudit
from app.db.models import User


def _body(response):
    return response.json()["data"]


def _sync_payload(
    *,
    operation_id: str,
    entity_id: str,
    local_revision: int,
    data: dict,
    last_pulled_revision: int = 0,
):
    return {
        "deviceId": "AUDIT-DEVICE-1",
        "lastPulledRevision": last_pulled_revision,
        "changes": [
            {
                "operationId": operation_id,
                "entity": "Client",
                "operation": "CREATE" if local_revision == 1 else "UPDATE",
                "entityId": entity_id,
                "localRevision": local_revision,
                "data": data,
            }
        ],
    }


async def _create_client_via_sync(async_client, auth_headers, *, unique_suffix: str) -> tuple[str, int]:
    client_id = f"audit-client-{unique_suffix}"
    response = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            operation_id=f"audit-op-create-{unique_suffix}",
            entity_id=client_id,
            local_revision=1,
            data={
                "client_code": f"AUDIT-{unique_suffix}",
                "full_name": "Audit Replay Client",
                "preferred_language": "en",
                "city": "Juba",
            },
        ),
    )
    response.raise_for_status()
    return client_id, response.json()["meta"]["revision"]


@pytest.mark.asyncio
async def test_sync_audit_replay_chain_valid(async_client, auth_headers, db_session, unique_suffix):
    client_id, revision = await _create_client_via_sync(async_client, auth_headers, unique_suffix=unique_suffix)

    update_response = await async_client.post(
        "/sync/push",
        headers=auth_headers,
        json=_sync_payload(
            operation_id=f"audit-op-update-{unique_suffix}",
            entity_id=client_id,
            local_revision=1,
            data={"notes": "audit replay update"},
            last_pulled_revision=revision,
        ),
    )
    update_response.raise_for_status()

    replay_response = await async_client.get("/sync/audit/replay?since=0", headers=auth_headers)
    replay_response.raise_for_status()
    report = _body(replay_response)

    assert report["chain_valid"] is True
    assert report["event_count"] >= 2
    assert report["anomaly_count"] == 0
    assert report["replay_digest"] != "GENESIS"
    assert report["entity_operation_counts"]["Client"]["CREATE"] >= 1

    events = db_session.exec(select(SyncEvent).order_by(SyncEvent.server_revision)).all()
    audits = db_session.exec(select(SyncEventAudit).order_by(SyncEventAudit.server_revision)).all()
    assert len(events) == len(audits)


@pytest.mark.asyncio
async def test_sync_audit_replay_detects_tampering(async_client, auth_headers, db_session, unique_suffix):
    await _create_client_via_sync(async_client, auth_headers, unique_suffix=unique_suffix)

    tampered = db_session.exec(select(SyncEvent).order_by(SyncEvent.server_revision.desc())).first()
    assert tampered is not None

    statement = text("UPDATE sync_events SET payload_json = :payload WHERE server_revision = :revision").bindparams(
        payload='{"tampered":true}',
        revision=tampered.server_revision,
    )
    db_session.exec(statement)
    db_session.commit()

    replay_response = await async_client.get("/sync/audit/replay?since=0", headers=auth_headers)
    replay_response.raise_for_status()
    report = _body(replay_response)

    assert report["chain_valid"] is False
    assert report["anomaly_count"] >= 1
    anomaly_types = {anomaly["type"] for anomaly in report["anomalies"]}
    assert "PAYLOAD_HASH_MISMATCH" in anomaly_types or "EVENT_HASH_MISMATCH" in anomaly_types


@pytest.mark.asyncio
async def test_sync_audit_replay_requires_admin(async_client, db_session, unique_suffix):
    user = User(
        full_name="Staff User",
        email=f"staff-{unique_suffix}@pharmasync.local",
        password_hash=hash_password("StaffPass123!"),
        role="staff",
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()

    login_response = await async_client.post(
        "/auth/login",
        json={"email": user.email, "password": "StaffPass123!"},
    )
    login_response.raise_for_status()
    access_token = login_response.json()["data"]["access_token"]
    headers = {"Authorization": f"Bearer {access_token}"}

    replay_response = await async_client.get("/sync/audit/replay?since=0", headers=headers)
    export_response = await async_client.get("/sync/audit/export?since=0", headers=headers)
    assert replay_response.status_code == 403
    assert export_response.status_code == 403


@pytest.mark.asyncio
async def test_sync_audit_export_includes_signed_snapshot(async_client, auth_headers, unique_suffix):
    await _create_client_via_sync(async_client, auth_headers, unique_suffix=unique_suffix)

    replay_response = await async_client.get("/sync/audit/replay?since=0", headers=auth_headers)
    replay_response.raise_for_status()
    replay_report = _body(replay_response)
    assert replay_report["signature"]
    assert replay_report["signatureAlgorithm"] == "hmac-sha256"
    assert replay_report["signedAt"]

    export_response = await async_client.get("/sync/audit/export?since=0&include_events=true", headers=auth_headers)
    export_response.raise_for_status()
    assert "attachment; filename=" in export_response.headers.get("content-disposition", "")
    payload = export_response.json()
    assert payload["snapshot_type"] == "sync_audit_snapshot"
    assert payload["signature"]["signature"]
    assert payload["signature"]["algorithm"] == "hmac-sha256"
    assert len(payload["events"]) >= 1
    assert len(payload["event_audit_chain"]) >= 1
