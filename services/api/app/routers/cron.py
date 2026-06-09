from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db import pool
from app.deps import admin_user

router = APIRouter()


class CronUpdate(BaseModel):
    cron_expr: str | None = None
    enabled: bool | None = None
    run_on_enable: bool | None = None


@router.get("/jobs")
async def list_jobs(_: dict = Depends(admin_user)) -> dict:
    db = await pool()
    rows = await db.fetch("select * from cron_jobs order by name")
    return {"jobs": [dict(row) for row in rows]}


@router.patch("/jobs/{job_id}")
async def update_job(job_id: str, payload: CronUpdate, _: dict = Depends(admin_user)) -> dict:
    fields = []
    values = []
    if payload.cron_expr is not None:
        fields.append("cron_expr")
        values.append(payload.cron_expr)
    if payload.enabled is not None:
        fields.append("enabled")
        values.append(payload.enabled)
    if payload.run_on_enable is not None:
        fields.append("run_on_enable")
        values.append(payload.run_on_enable)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    values.append(job_id)
    set_sql = ", ".join(f"{field} = ${idx + 1}" for idx, field in enumerate(fields))
    db = await pool()
    before = await db.fetchrow("select enabled, run_on_enable from cron_jobs where id = $1", job_id)
    if not before:
        raise HTTPException(status_code=404, detail="Job not found")
    row = await db.fetchrow(
        f"update cron_jobs set {set_sql}, updated_at = now() where id = ${len(values)} returning *",
        *values,
    )
    if row["enabled"] and row["run_on_enable"] and payload.enabled is True and not before["enabled"]:
        await db.execute(
            """
            insert into cron_runs (job_id, status, error)
            values ($1, 'queued', 'run on enable')
            """,
            job_id,
        )
    return {"job": dict(row)}


@router.post("/jobs/{job_id}/run")
async def request_run(job_id: str, _: dict = Depends(admin_user)) -> dict:
    db = await pool()
    row = await db.fetchrow("select id from cron_jobs where id = $1", job_id)
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    await db.execute(
        """
        insert into cron_runs (job_id, status, error)
        values ($1, 'queued', 'manual request')
        """,
        job_id,
    )
    return {"queued": True}
