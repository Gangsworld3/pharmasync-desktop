from __future__ import annotations

from dataclasses import dataclass


VALID_ROLES = {"admin", "pharmacist", "cashier"}


PERMISSION_MATRIX: dict[str, set[str]] = {
    "admin:manage": {"admin"},
    "inventory:read": {"admin", "pharmacist", "cashier"},
    "inventory:mutate": {"admin", "pharmacist"},
    "clients:read": {"admin", "pharmacist", "cashier"},
    "clients:mutate": {"admin", "pharmacist"},
    "invoices:read": {"admin", "pharmacist", "cashier"},
    "invoices:create": {"admin", "pharmacist", "cashier"},
    "appointments:read": {"admin", "pharmacist"},
    "appointments:mutate": {"admin", "pharmacist"},
    "sync:read": {"admin", "pharmacist", "cashier"},
    "sync:run": {"admin", "pharmacist", "cashier"},
    "conflicts:manage": {"admin", "pharmacist"},
    "messages:mutate": {"admin", "pharmacist"},
}


@dataclass
class RBACError(PermissionError):
    permission: str
    role: str

    def __str__(self) -> str:
        normalized_role = self.role.strip().lower() if self.role else "unknown"
        return f"Role '{normalized_role}' is not allowed for permission '{self.permission}'."


def normalize_role(role: str | None) -> str:
    return (role or "").strip().lower()


def ensure_permission(permission: str, actor_role: str | None) -> None:
    role = normalize_role(actor_role)
    allowed_roles = PERMISSION_MATRIX.get(permission)
    if not allowed_roles:
        return
    if role not in allowed_roles:
        raise RBACError(permission=permission, role=role)

