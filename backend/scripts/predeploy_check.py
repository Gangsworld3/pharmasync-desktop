from __future__ import annotations

import argparse
import asyncio
import os
import subprocess
import sys
import uuid
from typing import Any

import httpx


def run_migrations() -> None:
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True)


async def _request(
    client: httpx.AsyncClient,
    method: str,
    path: str,
    *,
    expected_status: int,
    json_body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    response = await client.request(method, path, json=json_body, headers=headers)
    if response.status_code != expected_status:
        raise RuntimeError(f"{method} {path} -> {response.status_code}, expected {expected_status}. body={response.text}")
    return response.json()


async def run_smoke(base_url: str, admin_email: str, admin_password: str) -> None:
    async with httpx.AsyncClient(base_url=base_url, timeout=30) as client:
        health = await _request(client, "GET", "/health", expected_status=200)
        if health.get("status") != "ok":
            raise RuntimeError("Health endpoint did not return status=ok.")

        login = await _request(
            client,
            "POST",
            "/auth/login",
            expected_status=200,
            json_body={"email": admin_email, "password": admin_password},
        )
        login_data = login["data"]
        access_token = login_data["access_token"]
        refresh_token = login_data["refresh_token"]

        refreshed = await _request(
            client,
            "POST",
            "/auth/refresh",
            expected_status=200,
            json_body={"refresh_token": refresh_token},
        )
        new_refresh = refreshed["data"]["refresh_token"]
        replay_old = await _request(
            client,
            "POST",
            "/auth/refresh",
            expected_status=401,
            json_body={"refresh_token": refresh_token},
        )
        if replay_old["error"]["code"] != "UNAUTHORIZED":
            raise RuntimeError("Refresh replay attack check failed.")

        auth_headers = {"Authorization": f"Bearer {access_token}"}
        suffix = uuid.uuid4().hex[:10]
        sku = f"SMOKE-{suffix}"

        await _request(
            client,
            "POST",
            "/inventory",
            expected_status=201,
            headers=auth_headers,
            json_body={
                "sku": sku,
                "name": f"Smoke {sku}",
                "category": "General",
                "quantity_on_hand": 5,
                "reorder_level": 1,
                "unit_cost_minor": 100,
                "sale_price_minor": 200,
            },
        )

        invoice_payload = {
            "invoice_number": f"SMOKE-INV-{suffix}",
            "payment_method": "CASH",
            "items": [{"inventory_sku": sku, "quantity": 1}],
        }
        idempotency_key = f"smoke-key-{suffix}"
        invoice_headers = {**auth_headers, "Idempotency-Key": idempotency_key}
        first = await _request(
            client,
            "POST",
            "/invoices",
            expected_status=201,
            headers=invoice_headers,
            json_body=invoice_payload,
        )
        second = await _request(
            client,
            "POST",
            "/invoices",
            expected_status=201,
            headers=invoice_headers,
            json_body=invoice_payload,
        )
        if first != second:
            raise RuntimeError("Idempotency replay check failed.")

        # Ensure newly issued refresh token remains valid before replay detector fires on it.
        await _request(
            client,
            "POST",
            "/auth/refresh",
            expected_status=200,
            json_body={"refresh_token": new_refresh},
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run migration and smoke checks before deployment.")
    parser.add_argument("--skip-migrate", action="store_true", help="Skip alembic upgrade head.")
    parser.add_argument("--base-url", default=os.getenv("SMOKE_BASE_URL", "http://127.0.0.1:10000"))
    parser.add_argument("--admin-email", default=os.getenv("SMOKE_ADMIN_EMAIL", "admin@pharmasync.local"))
    parser.add_argument("--admin-password", default=os.getenv("SMOKE_ADMIN_PASSWORD", "Admin123!"))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.skip_migrate:
        run_migrations()
    asyncio.run(run_smoke(args.base_url, args.admin_email, args.admin_password))
    print("Predeploy checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
