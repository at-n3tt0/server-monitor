from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from dotenv import load_dotenv


ROOT_DIR = Path(__file__).resolve().parents[3]
load_dotenv(ROOT_DIR / ".env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ROOT_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "server-monitor"
    environment: Literal["development", "staging", "production"] = "development"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])

    database_url: str = "postgresql+psycopg2://server_monitor:server_monitor@localhost:5432/server_monitor"
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 720

    bootstrap_admin_username: str = "admin"
    bootstrap_admin_password: str = "admin123!"

    monitoring_poll_interval_seconds: int = 10
    dashboard_default_range_minutes: int = 60
    legacy_config_path: Path = ROOT_DIR / "config" / "monitor.json"
    legacy_sqlite_path: Path = ROOT_DIR / "backend" / "data" / "monitor.db"
    auto_import_legacy_targets: bool = True
    auto_import_legacy_history: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
