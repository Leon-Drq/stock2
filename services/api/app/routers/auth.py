from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, EmailStr

from app.config import get_settings
from app.db import execute, fetch, fetchrow
from app.deps import admin_user, current_user
from app.security import new_session_token, session_expires_at, session_token_hash, verify_password

router = APIRouter()


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


@router.post("/login")
async def login(payload: LoginRequest, response: Response) -> dict:
    user = await fetchrow(
        "select id, email, password_hash, role, status from users where email = $1",
        payload.email.lower(),
    )
    if not user or user["status"] != "active" or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    token = new_session_token()
    expires_at = session_expires_at()
    await execute(
        "insert into sessions (user_id, token_hash, expires_at) values ($1, $2, $3)",
        user["id"],
        session_token_hash(token),
        expires_at,
    )
    settings = get_settings()
    response.set_cookie(
        settings.session_cookie_name,
        token,
        httponly=True,
        secure=False,
        samesite="lax",
        expires=expires_at,
    )
    return {"user": {"id": str(user["id"]), "email": user["email"], "role": user["role"]}, "expiresAt": expires_at}


@router.post("/logout")
async def logout(response: Response, user: dict = Depends(current_user)) -> dict:
    await execute("update sessions set revoked_at = now() where user_id = $1 and revoked_at is null", user["id"])
    response.delete_cookie(get_settings().session_cookie_name)
    return {"ok": True}


@router.get("/session")
async def session(user: dict = Depends(current_user)) -> dict:
    return {"user": {"id": str(user["id"]), "email": user["email"], "role": user["role"]}}


@router.get("/users")
async def list_users(_: dict = Depends(admin_user)) -> dict:
    rows = await fetch("select id, email, role, status, created_at from users order by created_at desc limit 200")
    return {"users": [dict(row) for row in rows]}
