from app.db import pool
from app.security import hash_password
from app.config import get_settings


async def ensure_bootstrap_admin() -> None:
    settings = get_settings()
    if not settings.bootstrap_admin_email or not settings.bootstrap_admin_password:
        return
    db = await pool()
    exists = await db.fetchval("select 1 from users where email = $1", settings.bootstrap_admin_email.lower())
    if exists:
        return
    await db.execute(
        """
        insert into users (email, password_hash, role, status)
        values ($1, $2, 'admin', 'active')
        """,
        settings.bootstrap_admin_email.lower(),
        hash_password(settings.bootstrap_admin_password),
    )
