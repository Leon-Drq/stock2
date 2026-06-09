import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db import pool
from app.deps import require_internal_token

router = APIRouter(dependencies=[Depends(require_internal_token)])


class QuotaRequest(BaseModel):
    user_id: str
    amount: int = 1
    feature: str = "default"


class UsageRequest(QuotaRequest):
    status: str = "success"
    metadata: dict | None = None


@router.post("/billing/check-quota")
async def check_quota(payload: QuotaRequest) -> dict:
    db = await pool()
    balance = await db.fetchval("select balance from credit_accounts where user_id = $1", payload.user_id)
    allowed = payload.amount <= int(balance or 0)
    return {"allowed": allowed, "balance": int(balance or 0)}


@router.post("/billing/record-usage")
async def record_usage(payload: UsageRequest) -> dict:
    if payload.amount < 0:
        raise HTTPException(status_code=400, detail="amount must be non-negative")
    db = await pool()
    async with db.acquire() as conn:
        async with conn.transaction():
            if payload.amount:
                await conn.execute(
                    """
                    update credit_accounts
                    set balance = greatest(0, balance - $2), updated_at = now()
                    where user_id = $1
                    """,
                    payload.user_id,
                    payload.amount,
                )
                await conn.execute(
                    """
                    insert into credit_transactions (user_id, amount, kind, note)
                    values ($1, $2, 'usage', $3)
                    """,
                    payload.user_id,
                    -payload.amount,
                    payload.feature,
                )
            await conn.execute(
                """
                insert into usage_ledger (user_id, feature, amount, status, metadata)
                values ($1, $2, $3, $4, $5::jsonb)
                """,
                payload.user_id,
                payload.feature,
                payload.amount,
                payload.status,
                json.dumps(payload.metadata or {}),
            )
    return {"ok": True}
