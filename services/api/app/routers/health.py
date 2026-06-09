from fastapi import APIRouter, Request

from app.db import fetchval

router = APIRouter()


@router.get("/healthz")
async def healthz(request: Request) -> dict:
    await fetchval("select 1")
    return {
        "ok": True,
        "service": "stock2-api",
        "migrationsExecuted": getattr(request.app.state, "migrations_executed", []),
    }
