from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_ready_endpoint_reports_dependencies(async_client):
    response = await async_client.get("/ready")
    response.raise_for_status()
    payload = response.json()
    assert payload["status"] in {"ok", "degraded"}
    assert "dependencies" in payload
    assert "database" in payload["dependencies"]
    assert "redis" in payload["dependencies"]


@pytest.mark.asyncio
async def test_metrics_endpoint_exposes_prometheus_format(async_client):
    response = await async_client.get("/metrics")
    response.raise_for_status()
    body = response.text
    assert "pharmasync_http_requests_total" in body
    assert "pharmasync_http_request_duration_seconds" in body
