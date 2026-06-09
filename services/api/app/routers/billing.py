from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db import fetchrow, transaction
from app.deps import admin_user, current_user

router = APIRouter()


class CreditGrant(BaseModel):
    user_id: str
    amount: int
    note: str | None = None


@router.get("/me")
async def my_billing(user: dict = Depends(current_user)) -> dict:
    row = await fetchrow("select balance from credit_accounts where user_id = $1", user["id"])
    return {"balance": int(row["balance"]) if row else 0}


@router.post("/admin/grant")
async def grant_credits(payload: CreditGrant, _: dict = Depends(admin_user)) -> dict:
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="amount must be positive")
    async def grant(conn):
        await conn.execute(
            """
            insert into credit_accounts (user_id, balance)
            values ($1, $2)
            on conflict (user_id) do update set
              balance = credit_accounts.balance + excluded.balance,
              updated_at = now()
            """,
            payload.user_id,
            payload.amount,
        )
        await conn.execute(
            """
            insert into credit_transactions (user_id, amount, kind, note)
            values ($1, $2, 'grant', $3)
            """,
            payload.user_id,
            payload.amount,
            payload.note,
        )

    await transaction(grant)
    return {"ok": True}
