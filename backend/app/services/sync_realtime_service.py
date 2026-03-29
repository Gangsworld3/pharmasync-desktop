from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import WebSocket


class SyncRealtimeHub:
    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = {}

    async def connect(self, user_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.setdefault(user_id, set()).add(websocket)

    def disconnect(self, user_id: int, websocket: WebSocket) -> None:
        sockets = self._connections.get(user_id)
        if not sockets:
            return
        sockets.discard(websocket)
        if not sockets:
            self._connections.pop(user_id, None)

    async def broadcast_revision(self, revision: int, source_device_id: str | None = None) -> None:
        payload: dict[str, Any] = {
            "type": "sync.revision",
            "revision": revision,
            "sourceDeviceId": source_device_id,
            "sentAt": datetime.now(UTC).isoformat(),
        }

        stale_connections: list[tuple[int, WebSocket]] = []
        for user_id, sockets in self._connections.items():
            for socket in list(sockets):
                try:
                    await socket.send_json(payload)
                except Exception:  # noqa: BLE001
                    stale_connections.append((user_id, socket))

        for user_id, socket in stale_connections:
            self.disconnect(user_id, socket)


sync_realtime_hub = SyncRealtimeHub()
