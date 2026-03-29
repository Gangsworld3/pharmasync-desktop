from __future__ import annotations

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app


def _login_admin(client: TestClient) -> str:
    response = client.post(
        "/auth/login",
        json={"email": "admin@pharmasync.local", "password": "Admin123!"},
    )
    response.raise_for_status()
    return response.json()["data"]["access_token"]


def test_sync_ws_rejects_missing_token(db_session):  # noqa: ARG001
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/sync/ws"):
                pass


def test_sync_ws_receives_revision_events(db_session, unique_suffix):
    with TestClient(app) as client:
        token = _login_admin(client)
        headers = {"Authorization": f"Bearer {token}"}

        with client.websocket_connect(f"/sync/ws?token={token}") as websocket:
            payload = {
                "deviceId": f"ws-device-{unique_suffix}",
                "lastPulledRevision": 0,
                "changes": [
                    {
                        "operationId": f"ws-op-create-{unique_suffix}",
                        "entity": "Client",
                        "operation": "CREATE",
                        "entityId": f"ws-client-{unique_suffix}",
                        "localRevision": 1,
                        "data": {
                            "client_code": f"WS-{unique_suffix}",
                            "full_name": "Realtime Sync Client",
                            "preferred_language": "en",
                            "city": "Juba",
                        },
                    }
                ],
            }
            response = client.post("/sync/push", headers=headers, json=payload)
            response.raise_for_status()
            revision = response.json()["meta"]["revision"]
            assert revision > 0

            message = websocket.receive_json()
            assert message["type"] == "sync.revision"
            assert message["revision"] >= revision
            assert message["sourceDeviceId"] == payload["deviceId"]
