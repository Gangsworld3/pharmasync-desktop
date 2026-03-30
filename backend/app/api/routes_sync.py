import json
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel

from app.api.deps import SessionDep, require_role
from app.api.responses import success_response
from app.core.security import decode_access_token
from app.db.database import Session, engine
from app.db.models import User
from app.db.repositories import get_active_by_id
from app.services.sync_audit_service import export_sync_audit_snapshot, replay_sync_audit, sign_sync_audit_report
from app.services.sync_realtime_service import sync_realtime_hub
from app.services.sync_service import handle_sync_pull, handle_sync_push


router = APIRouter(prefix="/sync", tags=["sync"])


class SyncChange(BaseModel):
    operationId: str
    entity: str
    operation: str
    entityId: str
    localRevision: int
    data: dict


class SyncPushPayload(BaseModel):
    deviceId: str
    lastPulledRevision: int = 0
    changes: list[SyncChange]


@router.post("/push")
async def sync_push(
    payload: SyncPushPayload,
    session: SessionDep,
    current_user: Annotated[User, Depends(require_role("admin", "pharmacist", "cashier"))],
):
    try:
        result = handle_sync_push(session, payload.model_dump(), current_user=current_user)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if result["newRevision"] > payload.lastPulledRevision:
        await sync_realtime_hub.broadcast_revision(
            result["newRevision"],
            source_device_id=payload.deviceId,
        )
    return success_response(
        {
            "applied": result["applied"],
            "conflicts": result["conflicts"],
            "serverChanges": result["serverChanges"],
            "results": result["results"],
        },
        meta={"revision": result["newRevision"]},
    )


@router.get("/pull")
def sync_pull(
    since: int,
    session: SessionDep,
    current_user: Annotated[User, Depends(require_role("admin", "pharmacist", "cashier"))],
    deviceId: str | None = None,
):
    try:
        result = handle_sync_pull(session, since, device_id=deviceId, current_user=current_user)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return success_response(
        {"serverChanges": result["serverChanges"]},
        meta={"revision": result["newRevision"]},
    )


@router.websocket("/ws")
async def sync_websocket(websocket: WebSocket):
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    try:
        payload = decode_access_token(token)
        user_id = int(payload["sub"])
    except Exception:  # noqa: BLE001
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    with Session(engine) as session:
        user = get_active_by_id(session, User, user_id)
        if not user or not user.is_active:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

    await sync_realtime_hub.connect(user_id, websocket)
    try:
        while True:
            message = await websocket.receive_text()
            if message.lower() == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        sync_realtime_hub.disconnect(user_id, websocket)


@router.get("/audit/replay")
def sync_audit_replay(
    session: SessionDep,
    current_user: Annotated[User, Depends(require_role("admin"))],
    since: int = 0,
    upto: int | None = None,
):
    if since < 0:
        raise HTTPException(status_code=422, detail="since must be >= 0")
    if upto is not None and upto < since:
        raise HTTPException(status_code=422, detail="upto must be >= since")

    report = replay_sync_audit(
        session,
        since_revision=since,
        upto_revision=upto,
        tenant_id=current_user.tenant_id,
    )
    signature = sign_sync_audit_report(report)
    return success_response(
        {
            **report,
            "signature": signature["signature"],
            "signatureAlgorithm": signature["algorithm"],
            "signedAt": signature["signed_at"],
        },
        meta={"revision": report["upto_revision"]},
    )


@router.get("/audit/export")
def sync_audit_export(
    session: SessionDep,
    current_user: Annotated[User, Depends(require_role("admin"))],
    since: int = 0,
    upto: int | None = None,
    include_events: bool = True,
):
    if since < 0:
        raise HTTPException(status_code=422, detail="since must be >= 0")
    if upto is not None and upto < since:
        raise HTTPException(status_code=422, detail="upto must be >= since")

    snapshot = export_sync_audit_snapshot(
        session,
        since_revision=since,
        upto_revision=upto,
        include_events=include_events,
        tenant_id=current_user.tenant_id,
    )
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    filename = f"sync-audit-snapshot-{timestamp}.json"
    return Response(
        content=json.dumps(snapshot, default=str, separators=(",", ":"), sort_keys=True),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
