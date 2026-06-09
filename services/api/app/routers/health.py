from fastapi import APIRouter, Request

from app.db import pool

router = APIRouter()


@router.get("/healthz")
async def healthz(request: Request) -> dict:
    db = await pool()
    await db.fetchval("select 1")
    return {
        "ok": True,
        "service": "stock2-api",
        "migrationsExecuted": getattr(request.app.state, "migrations_executed", []),
    }
