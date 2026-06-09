import asyncio
import time
from datetime import UTC, datetime

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.config import get_settings
from app.db import close_pool, init_pool, pool
from app.migrations import run_migrations


async def execute_job(job_id: str) -> None:
    settings = get_settings()
    db = await pool()
    job = await db.fetchrow("select * from cron_jobs where id = $1 and enabled = true", job_id)
    if not job:
        return

    started = datetime.now(tz=UTC)
    run_id = await db.fetchval(
        "insert into cron_runs (job_id, status, started_at) values ($1, 'running', $2) returning id",
        job_id,
        started,
    )
    url = settings.next_internal_base_url.rstrip("/") + job["target_path"]
    status = "success"
    http_status = None
    error = None
    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=job["timeout_seconds"]) as client:
            response = await client.get(url, headers={"Authorization": f"Bearer {settings.internal_cron_token}"})
            http_status = response.status_code
            if response.status_code >= 400:
                status = "failure"
                error = response.text[:500]
    except Exception as exc:  # noqa: BLE001
        status = "exception"
        error = str(exc)[:500]
    duration_ms = int((time.perf_counter() - start) * 1000)
    await db.execute(
        """
        update cron_runs
        set status = $2, finished_at = now(), http_status = $3, error = $4, duration_ms = $5
        where id = $1
        """,
        run_id,
        status,
        http_status,
        error,
        duration_ms,
    )
    await db.execute(
        """
        update cron_jobs
        set last_run_at = now(), last_status = $2, last_error = $3, updated_at = now()
        where id = $1
        """,
        job_id,
        status,
        error,
    )


async def reload_jobs(scheduler: AsyncIOScheduler) -> None:
    db = await pool()
    rows = await db.fetch("select id, cron_expr, max_instances from cron_jobs where enabled = true")
    active_ids = {row["id"] for row in rows}
    for job in list(scheduler.get_jobs()):
        if job.id not in active_ids:
            scheduler.remove_job(job.id)
    for row in rows:
        trigger = CronTrigger.from_crontab(row["cron_expr"], timezone="Asia/Shanghai")
        if scheduler.get_job(row["id"]):
            scheduler.reschedule_job(row["id"], trigger=trigger)
        else:
            scheduler.add_job(
                execute_job,
                trigger=trigger,
                args=[row["id"]],
                id=row["id"],
                max_instances=row["max_instances"],
                replace_existing=True,
            )


async def run_queued_manual_jobs() -> None:
    db = await pool()
    rows = await db.fetch(
        """
        select id, job_id
        from cron_runs
        where status = 'queued'
        order by started_at asc
        limit 20
        """
    )
    for row in rows:
        await db.execute("delete from cron_runs where id = $1 and status = 'queued'", row["id"])
        await execute_job(row["job_id"])


async def main() -> None:
    db_pool = await init_pool()
    await run_migrations(db_pool)
    scheduler = AsyncIOScheduler(timezone="Asia/Shanghai")
    scheduler.add_job(reload_jobs, "interval", seconds=30, args=[scheduler], id="reload-jobs")
    scheduler.add_job(run_queued_manual_jobs, "interval", seconds=5, id="manual-jobs")
    await reload_jobs(scheduler)
    scheduler.start()
    try:
        while True:
            await asyncio.sleep(3600)
    finally:
        scheduler.shutdown(wait=False)
        await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
