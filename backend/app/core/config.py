import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


def normalize_database_url(url: str) -> str:
    if url.startswith("postgresql+psycopg://"):
        return url
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    return url


class Settings(BaseSettings):
    app_name: str = "PharmaSync FastAPI"
    jwt_secret: str = (
        os.getenv("PHARMASYNC_JWT_SECRET")
        or os.getenv("SECRET_KEY")
        or "FlyV1 fm2_lJPECAAAAAAAEtJsxBDYmNq//LwK4ZvWmHLySVkbwrVodHRwczovL2FwaS5mbHkuaW8vdjGWAJLOABfMWh8Lk7lodHRwczovL2FwaS5mbHkuaW8vYWFhL3YxxDza8BLpFuoJYNlwg/XF1cXhWPPsj/Yj6zNjbbMycBSfh2yCk9MlHk3G7QFRsyyjKnq0TBmOLoClIbJcbcfETvLJmU2yjcC23aDn8AwKN5bN9b5yJPjvnqYrpxus5IHWEugDkzxDbwCsRcTlapBh8l+uW+5BcUAhH1hIE26wtSzFhMwOHJkryKUpyjkoFg2SlAORgc4A7BVqHwWRgqdidWlsZGVyH6J3Zx8BxCDmHkoZvJbV59PaY235BAYf7jWpXv7JNnwYP4A1kO0Crw==,fm2_lJPETvLJmU2yjcC23aDn8AwKN5bN9b5yJPjvnqYrpxus5IHWEugDkzxDbwCsRcTlapBh8l+uW+5BcUAhH1hIE26wtSzFhMwOHJkryKUpyjkoFsQQ5jEVEJ2m6dHfvCU0l4fkQMO5aHR0cHM6Ly9hcGkuZmx5LmlvL2FhYS92MZgEks5pyG13zwAAAAElwIuVF84AFtBpCpHOABbQaQzEEDsc1CTE2FmbdkU5F9cpjFzEIHZOI7+QZOhFAKh88hSHkLsDPzGIeRc1CVhCv82siiil"
    )
    jwt_algorithm: str = "HS256"
    jwt_exp_minutes: int = 720
    default_admin_email: str = "admin@pharmasync.local"
    default_admin_password: str = "Admin123!"
    database_url: str = normalize_database_url(
        os.getenv("DATABASE_URL")
        or os.getenv("PHARMASYNC_DATABASE_URL")
        or "postgresql+psycopg://pharma:secure123@localhost:5432/pharmasync"
    )

    model_config = SettingsConfigDict(
        env_prefix="PHARMASYNC_",
        env_file=str(Path(__file__).resolve().parents[2] / ".env"),
        extra="ignore",
    )


settings = Settings()
