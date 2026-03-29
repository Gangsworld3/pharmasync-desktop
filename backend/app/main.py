from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.responses import success_response
from app.api.routes_appointments import router as appointments_router
from app.api.routes_auth import router as auth_router
from app.api.routes_clients import router as clients_router
from app.api.routes_conflicts import router as conflicts_router
from app.api.routes_inventory import router as inventory_router
from app.api.routes_invoices import router as invoices_router
from app.api.routes_messages import router as messages_router
from app.api.routes_sync import router as sync_router
from app.core.config import settings
from app.db.database import Session, engine, init_database
from app.db import models as _models  # noqa: F401
from app.services.auth_service import ensure_default_admin


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_database()
    with Session(engine) as session:
        ensure_default_admin(session)
    yield


app = FastAPI(title=settings.app_name, version="0.3.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/")
def root():
    return success_response({"service": settings.app_name, "status": "ok"})


app.include_router(auth_router)
app.include_router(clients_router)
app.include_router(conflicts_router)
app.include_router(inventory_router)
app.include_router(appointments_router)
app.include_router(messages_router)
app.include_router(invoices_router)
app.include_router(sync_router)
