from typing import Annotated

from fastapi import Cookie, Depends, Header, HTTPException, Request, status

from app.config import get_settings
from app.db import fetchrow
from app.security import session_token_hash


async def current_user(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    session_cookie: Annotated[str | None, Cookie(alias="stock2_session")] = None,
) -> dict:
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
    token = token or request.cookies.get(get_settings().session_cookie_name) or session_cookie
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    token_hash = session_token_hash(token)
    row = await fetchrow(
        """
        select u.id, u.email, u.role, u.status
        from sessions s
        join users u on u.id = s.user_id
        where s.token_hash = $1
          and s.revoked_at is null
          and s.expires_at > now()
          and u.status = 'active'
        """,
        token_hash,
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    return dict(row)


async def admin_user(user: Annotated[dict, Depends(current_user)]) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return user


def require_internal_token(authorization: Annotated[str | None, Header()] = None) -> None:
    expected = get_settings().internal_api_token
    if not expected or expected == "change-me":
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Internal token is not configured")
    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid internal token")
