from __future__ import annotations

from sqlmodel import Session, select

from app.db.models import Tenant, User
from app.db.repos.entity_repo import utc_now


def create_tenant(session: Session, *, tenant_id: str, name: str, is_active: bool = True) -> Tenant:
    tenant = Tenant(id=tenant_id, name=name, is_active=is_active, updated_at=utc_now())
    session.add(tenant)
    session.flush()
    return tenant


def list_tenants(session: Session) -> list[Tenant]:
    return list(session.exec(select(Tenant).order_by(Tenant.created_at)))


def get_tenant(session: Session, tenant_id: str) -> Tenant | None:
    return session.exec(select(Tenant).where(Tenant.id == tenant_id)).first()


def assign_user_tenant(session: Session, *, user_id: int, tenant_id: str) -> User | None:
    user = session.exec(select(User).where(User.id == user_id).where(User.deleted_at.is_(None))).first()
    if not user:
        return None
    user.tenant_id = tenant_id
    user.updated_at = utc_now()
    session.add(user)
    session.flush()
    return user


def set_tenant_active(session: Session, *, tenant_id: str, is_active: bool) -> Tenant | None:
    tenant = get_tenant(session, tenant_id)
    if not tenant:
        return None
    tenant.is_active = is_active
    tenant.updated_at = utc_now()
    session.add(tenant)
    session.flush()
    return tenant
