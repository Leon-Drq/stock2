from app.config import get_settings
from app.db import execute, fetchval
from app.security import hash_password


async def ensure_bootstrap_admin() -> None:
    settings = get_settings()
    if not settings.bootstrap_admin_email or not settings.bootstrap_admin_password:
        return
    exists = await fetchval("select 1 from users where email = $1", settings.bootstrap_admin_email.lower())
    if exists:
        return
    await execute(
        """
        insert into users (email, password_hash, role, status)
        values ($1, $2, 'admin', 'active')
        """,
        settings.bootstrap_admin_email.lower(),
        hash_password(settings.bootstrap_admin_password),
    )
