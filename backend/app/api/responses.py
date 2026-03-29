from __future__ import annotations

from decimal import Decimal
from typing import Any

from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse


def _encode_payload(data: Any) -> Any:
    return jsonable_encoder(
        data,
        custom_encoder={
            Decimal: lambda value: str(value),
        },
    )


def success_response(data: Any, meta: dict[str, Any] | None = None, status_code: int = 200) -> JSONResponse:
    payload = {
        "status": "success",
        "data": _encode_payload(data),
        "meta": _encode_payload(meta or {}),
    }
    return JSONResponse(status_code=status_code, content=payload)
