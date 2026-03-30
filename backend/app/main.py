import logging
import time
from uuid import uuid4
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import Response
from fastapi.responses import JSONResponse
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest

from app.api.errors import error_response, map_error_code
from app.api.responses import success_response
from app.api.routes_appointments import router as appointments_router
from app.api.routes_analytics import router as analytics_router
from app.api.routes_auth import router as auth_router
from app.api.routes_clients import router as clients_router
from app.api.routes_conflicts import router as conflicts_router
from app.api.routes_inventory import router as inventory_router
from app.api.routes_invoices import router as invoices_router
from app.api.routes_messages import router as messages_router
from app.api.routes_sync import router as sync_router
from app.core.config import settings
from app.core.health import database_ready, redis_ready
from app.core.logging import configure_logging
from app.db.database import Session, engine, init_database
from app.db import models as _models  # noqa: F401
from app.services.background_dispatcher import dispatcher
from app.services.auth_service import ensure_default_admin

configure_logging()
logger = logging.getLogger("pharmasync.api")
REQUEST_COUNT = Counter(
    "pharmasync_http_requests_total",
    "Total HTTP requests",
    ["method", "path", "status_code"],
)
REQUEST_LATENCY_SECONDS = Histogram(
    "pharmasync_http_request_duration_seconds",
    "HTTP request latency in seconds",
    ["method", "path", "status_code"],
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    dispatcher.start()
    init_database()
    with Session(engine) as session:
        ensure_default_admin(session)
    try:
        yield
    finally:
        dispatcher.stop()


app = FastAPI(title=settings.app_name, version="0.3.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID", uuid4().hex)
    request.state.request_id = request_id
    request.state.user_id = None
    started = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
    path_template = _metric_path(request)
    status_code = str(response.status_code)
    REQUEST_COUNT.labels(method=request.method, path=path_template, status_code=status_code).inc()
    REQUEST_LATENCY_SECONDS.labels(method=request.method, path=path_template, status_code=status_code).observe(
        elapsed_ms / 1000
    )
    response.headers["X-Request-ID"] = request_id
    logger.info(
        "request_complete",
        extra={
            "request_id": request_id,
            "user_id": request.state.user_id,
            "method": request.method,
            "path": request.url.path,
            "status_code": response.status_code,
            "latency_ms": elapsed_ms,
        },
    )
    return response


def _metric_path(request: Request) -> str:
    route = request.scope.get("route")
    if route is not None and hasattr(route, "path"):
        return str(route.path)
    return request.url.path


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    status_code = exc.status_code
    message = str(exc.detail)
    error_code = map_error_code(status_code, exc.detail)
    logger.warning(
        "request_failed",
        extra={
            "request_id": getattr(request.state, "request_id", None),
            "user_id": getattr(request.state, "user_id", None),
            "method": request.method,
            "path": request.url.path,
            "status_code": status_code,
            "error_code": error_code,
        },
    )
    return error_response(
        status_code=status_code,
        message=message,
        code=error_code,
        request_id=getattr(request.state, "request_id", None),
    )


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.warning(
        "request_validation_failed",
        extra={
            "request_id": getattr(request.state, "request_id", None),
            "user_id": getattr(request.state, "user_id", None),
            "method": request.method,
            "path": request.url.path,
            "status_code": 422,
            "error_code": "VALIDATION_ERROR",
        },
    )
    return error_response(
        status_code=422,
        message="Request validation failed.",
        code="VALIDATION_ERROR",
        request_id=getattr(request.state, "request_id", None),
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):  # noqa: ARG001
    logger.exception(
        "unhandled_exception",
        extra={
            "request_id": getattr(request.state, "request_id", None),
            "user_id": getattr(request.state, "user_id", None),
            "method": request.method,
            "path": request.url.path,
            "status_code": 500,
            "error_code": "INTERNAL_ERROR",
        },
    )
    return error_response(
        status_code=500,
        message="Internal server error.",
        code="INTERNAL_ERROR",
        request_id=getattr(request.state, "request_id", None),
    )


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/ready")
def ready():
    db_ok, db_state = database_ready()
    redis_ok, redis_state = redis_ready()
    healthy = db_ok and redis_ok
    payload = {
        "status": "ok" if healthy else "degraded",
        "dependencies": {
            "database": db_state,
            "redis": redis_state,
        },
    }
    if healthy:
        return payload
    return JSONResponse(status_code=503, content=payload)


@app.get("/metrics")
def metrics():
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/")
def root():
    return success_response({"service": settings.app_name, "status": "ok"})


app.include_router(auth_router)
app.include_router(analytics_router)
app.include_router(clients_router)
app.include_router(conflicts_router)
app.include_router(inventory_router)
app.include_router(appointments_router)
app.include_router(messages_router)
app.include_router(invoices_router)
app.include_router(sync_router)
