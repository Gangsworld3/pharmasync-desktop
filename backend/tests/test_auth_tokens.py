from __future__ import annotations

import pytest


def _body(response):
    return response.json()["data"]


@pytest.mark.asyncio
async def test_login_returns_access_and_refresh_tokens(async_client):
    response = await async_client.post(
        "/auth/login",
        json={"email": "admin@pharmasync.local", "password": "Admin123!"},
    )
    response.raise_for_status()

    payload = _body(response)
    assert payload["token_type"] == "bearer"
    assert payload["access_token"]
    assert payload["refresh_token"]


@pytest.mark.asyncio
async def test_refresh_rotates_token_and_invalidates_old_one(async_client):
    login = await async_client.post(
        "/auth/login",
        json={"email": "admin@pharmasync.local", "password": "Admin123!"},
    )
    login.raise_for_status()
    initial = _body(login)

    refresh = await async_client.post(
        "/auth/refresh",
        json={"refresh_token": initial["refresh_token"]},
    )
    refresh.raise_for_status()
    rotated = _body(refresh)

    assert rotated["refresh_token"] != initial["refresh_token"]

    replay_old = await async_client.post(
        "/auth/refresh",
        json={"refresh_token": initial["refresh_token"]},
    )
    assert replay_old.status_code == 401
    assert replay_old.json()["error"]["message"] == "Refresh token has been revoked."

    # Replay detection should revoke all active sessions for that user.
    replay_new = await async_client.post(
        "/auth/refresh",
        json={"refresh_token": rotated["refresh_token"]},
    )
    assert replay_new.status_code == 401
    assert replay_new.json()["error"]["message"] == "Refresh token has been revoked."


@pytest.mark.asyncio
async def test_refreshed_access_token_can_access_protected_routes(async_client):
    login = await async_client.post(
        "/auth/login",
        json={"email": "admin@pharmasync.local", "password": "Admin123!"},
    )
    login.raise_for_status()
    refresh_token = _body(login)["refresh_token"]

    refreshed = await async_client.post(
        "/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    refreshed.raise_for_status()
    access_token = _body(refreshed)["access_token"]

    response = await async_client.get(
        "/clients",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    response.raise_for_status()
    assert response.json()["status"] == "success"
