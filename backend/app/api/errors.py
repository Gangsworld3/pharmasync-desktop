from __future__ import annotations

from typing import Any

from fastapi.responses import JSONResponse


def map_error_code(status_code: int, detail: Any) -> str:
    detail_text = str(detail or "").strip().lower()
    if "insufficient stock" in detail_text:
        return "INSUFFICIENT_STOCK"
    if "idempotency-key" in detail_text:
        return "IDEMPOTENCY_KEY_CONFLICT"
    if "invalid token" in detail_text:
        return "INVALID_TOKEN"
    if status_code == 400:
        return "BAD_REQUEST"
    if status_code == 401:
        return "UNAUTHORIZED"
    if status_code == 403:
        return "FORBIDDEN"
    if status_code == 404:
        return "NOT_FOUND"
    if status_code == 409:
        return "CONFLICT"
    if status_code == 422:
        return "VALIDATION_ERROR"
    if status_code >= 500:
        return "INTERNAL_ERROR"
    return "REQUEST_ERROR"


def error_response(
    *,
    status_code: int,
    message: str,
    code: str,
    request_id: str | None = None,
) -> JSONResponse:
    payload: dict[str, Any] = {
        "error": {
            "code": code,
            "message": message,
            "request_id": request_id,
        }
    }
    response = JSONResponse(status_code=status_code, content=payload)
    if request_id:
        response.headers["X-Request-ID"] = request_id
    return response
