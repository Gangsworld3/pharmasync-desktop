from __future__ import annotations

import importlib
import sys

import pytest


def _reload_config_module():
    sys.modules.pop("app.core.config", None)
    import app.core.config as config_module

    return importlib.reload(config_module)


def _clear_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in (
        "ENV",
        "DATABASE_URL",
        "PHARMASYNC_DATABASE_URL",
        "PHARMASYNC_JWT_SECRET",
        "SECRET_KEY",
        "PHARMASYNC_DEFAULT_ADMIN_PASSWORD",
    ):
        monkeypatch.delenv(key, raising=False)


def test_production_requires_database_url(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("ENV", "production")
    monkeypatch.setenv("PHARMASYNC_JWT_SECRET", "prod-jwt-secret")
    monkeypatch.setenv("PHARMASYNC_DEFAULT_ADMIN_PASSWORD", "ProdAdmin!123")

    with pytest.raises(RuntimeError, match="Missing PHARMASYNC_DATABASE_URL in production"):
        _reload_config_module()


def test_production_requires_jwt_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("ENV", "production")
    monkeypatch.setenv(
        "PHARMASYNC_DATABASE_URL", "postgresql://user:pass@db.example.com:5432/pharmasync"
    )
    monkeypatch.setenv("PHARMASYNC_DEFAULT_ADMIN_PASSWORD", "ProdAdmin!123")

    with pytest.raises(RuntimeError, match="Missing JWT secret in production"):
        _reload_config_module()


def test_production_requires_admin_password(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("ENV", "production")
    monkeypatch.setenv("PHARMASYNC_JWT_SECRET", "prod-jwt-secret")
    monkeypatch.setenv(
        "PHARMASYNC_DATABASE_URL", "postgresql://user:pass@db.example.com:5432/pharmasync"
    )

    with pytest.raises(
        RuntimeError, match="Missing PHARMASYNC_DEFAULT_ADMIN_PASSWORD in production"
    ):
        _reload_config_module()


def test_development_bootstrap_uses_safe_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("ENV", "development")

    config_module = _reload_config_module()

    assert config_module.settings.jwt_secret
    assert config_module.settings.default_admin_password
    assert config_module.settings.database_url == config_module.LOCAL_DEV_DATABASE_URL


def test_production_rejects_legacy_database_url(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("ENV", "production")
    monkeypatch.setenv("PHARMASYNC_JWT_SECRET", "prod-jwt-secret")
    monkeypatch.setenv("PHARMASYNC_DEFAULT_ADMIN_PASSWORD", "ProdAdmin!123")
    monkeypatch.setenv(
        "DATABASE_URL", "postgresql://user:pass@db.example.com:5432/pharmasync"
    )

    with pytest.raises(RuntimeError, match="DATABASE_URL is not allowed in production"):
        _reload_config_module()


def test_production_rejects_conflicting_database_urls(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("ENV", "production")
    monkeypatch.setenv("PHARMASYNC_JWT_SECRET", "prod-jwt-secret")
    monkeypatch.setenv("PHARMASYNC_DEFAULT_ADMIN_PASSWORD", "ProdAdmin!123")
    monkeypatch.setenv(
        "DATABASE_URL", "postgresql://legacy:pass@db.example.com:5432/pharmasync"
    )
    monkeypatch.setenv(
        "PHARMASYNC_DATABASE_URL", "postgresql://primary:pass@db.example.com:5432/pharmasync"
    )

    with pytest.raises(RuntimeError, match="Set only PHARMASYNC_DATABASE_URL"):
        _reload_config_module()
