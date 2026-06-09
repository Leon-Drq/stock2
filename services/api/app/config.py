from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = Field(alias="DATABASE_URL")
    session_secret: str = Field(default="change-me", alias="SESSION_SECRET")
    internal_api_token: str = Field(default="change-me", alias="INTERNAL_API_TOKEN")
    internal_cron_token: str = Field(default="change-me", alias="INTERNAL_CRON_TOKEN")
    next_internal_base_url: str = Field(default="http://stock2-web:3000", alias="NEXT_INTERNAL_BASE_URL")
    bootstrap_admin_email: str | None = Field(default=None, alias="BOOTSTRAP_ADMIN_EMAIL")
    bootstrap_admin_password: str | None = Field(default=None, alias="BOOTSTRAP_ADMIN_PASSWORD")
    session_cookie_name: str = Field(default="stock2_session", alias="SESSION_COOKIE_NAME")
    session_ttl_seconds: int = Field(default=60 * 60 * 24 * 7, alias="SESSION_TTL_SECONDS")
    cors_origins: str = Field(default="http://localhost:3000", alias="CORS_ORIGINS")


@lru_cache
def get_settings() -> Settings:
    return Settings()
