from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import SessionDep, get_current_user, require_role
from app.api.responses import success_response
from app.db.models import User
from app.db.repositories import (
    append_audit_log,
    assign_user_tenant,
    create_tenant,
    get_tenant,
    list_tenants,
    set_tenant_active,
)


router = APIRouter(prefix="/tenants", tags=["tenants"], dependencies=[Depends(get_current_user)])


class TenantCreatePayload(BaseModel):
    tenant_id: str = Field(min_length=2, max_length=64)
    name: str = Field(min_length=2, max_length=255)
    is_active: bool = True


class AssignUserPayload(BaseModel):
    user_id: int


class ActivateTenantPayload(BaseModel):
    is_active: bool


@router.get("")
def list_tenants_route(
    session: SessionDep,
    _: User = Depends(require_role("admin")),
):
    tenants = list_tenants(session)
    return success_response(tenants, meta={"count": len(tenants)})


@router.post("")
def create_tenant_route(
    payload: TenantCreatePayload,
    session: SessionDep,
    current_user: User = Depends(require_role("admin")),
):
    existing = get_tenant(session, payload.tenant_id)
    if existing:
        raise HTTPException(status_code=409, detail="Tenant already exists.")

    tenant = create_tenant(
        session,
        tenant_id=payload.tenant_id,
        name=payload.name,
        is_active=payload.is_active,
    )
    append_audit_log(
        session,
        action="Tenant.CREATE",
        table_name="tenants",
        record_id=tenant.id,
        user_id=current_user.id,
        actor_role=current_user.role,
        tenant_id=current_user.tenant_id,
        payload={"tenant_id": tenant.id, "name": tenant.name, "is_active": tenant.is_active},
    )
    session.commit()
    session.refresh(tenant)
    return success_response(tenant, status_code=201)


@router.post("/{tenant_id}/assign-user")
def assign_user_route(
    tenant_id: str,
    payload: AssignUserPayload,
    session: SessionDep,
    current_user: User = Depends(require_role("admin")),
):
    tenant = get_tenant(session, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found.")

    user = assign_user_tenant(session, user_id=payload.user_id, tenant_id=tenant_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    append_audit_log(
        session,
        action="Tenant.ASSIGN_USER",
        table_name="users",
        record_id=str(user.id),
        user_id=current_user.id,
        actor_role=current_user.role,
        tenant_id=current_user.tenant_id,
        payload={"target_user_id": user.id, "assigned_tenant_id": tenant_id},
    )
    session.commit()
    session.refresh(user)
    return success_response(
        {
            "user_id": user.id,
            "email": user.email,
            "tenant_id": user.tenant_id,
        }
    )


@router.patch("/{tenant_id}/activate")
def activate_tenant_route(
    tenant_id: str,
    payload: ActivateTenantPayload,
    session: SessionDep,
    current_user: User = Depends(require_role("admin")),
):
    tenant = set_tenant_active(session, tenant_id=tenant_id, is_active=payload.is_active)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found.")

    append_audit_log(
        session,
        action="Tenant.SET_ACTIVE",
        table_name="tenants",
        record_id=tenant.id,
        user_id=current_user.id,
        actor_role=current_user.role,
        tenant_id=current_user.tenant_id,
        payload={"tenant_id": tenant.id, "is_active": tenant.is_active},
    )
    session.commit()
    session.refresh(tenant)
    return success_response(tenant)

