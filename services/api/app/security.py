import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

import bcrypt

from app.config import get_settings


def utcnow() -> datetime:
    return datetime.now(tz=UTC)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def new_session_token() -> str:
    return secrets.token_urlsafe(48)


def session_token_hash(token: str) -> str:
    secret = get_settings().session_secret.encode("utf-8")
    return hmac.new(secret, token.encode("utf-8"), hashlib.sha256).hexdigest()


def session_expires_at() -> datetime:
    return utcnow() + timedelta(seconds=get_settings().session_ttl_seconds)
