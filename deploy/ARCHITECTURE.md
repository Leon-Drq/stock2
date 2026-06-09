# Release/Test Deployment Architecture

`release/test` keeps the existing Next.js stock product code and adds a Python control plane.

## Containers

- `stock2-web`: Next.js application on Node.js 24. It owns pages and the existing stock, radar, backtest, and paper-trading routes.
- `stock2-api`: Python 3.12 FastAPI service. It owns database initialization, users, sessions, billing, cron configuration, and internal APIs.
- `stock2-scheduler`: Python 3.12 APScheduler worker. It reuses the `stock2-api` image but runs `python -m app.scheduler_worker`.
- `postgres`: PostgreSQL 18.

## API and Scheduler Communication

`stock2-api` and `stock2-scheduler` communicate through PostgreSQL, not direct HTTP.

- Admin/API requests update `cron_jobs`.
- Manual run requests insert a queued row into `cron_runs`.
- Enabling a job with `run_on_enable=true` also inserts a queued row into `cron_runs`.
- The scheduler polls `cron_jobs` every 30 seconds and `cron_runs` every 5 seconds.
- Enabled jobs are registered in APScheduler.
- When a job fires, the scheduler calls the internal Next.js route with `INTERNAL_CRON_TOKEN`.

This keeps the scheduler stateless and restartable. A later optimization can replace polling with Postgres `LISTEN/NOTIFY`, but it is not required for the first phase.

## Configuration Page

A separate configuration-page Docker container is not needed.

The configuration UI lives in `stock2-web` and calls `stock2-api` through the same-origin `/api/control/*` proxy:

- Cron management: `/ops/cron`
- User management: `/ops/users` can be added in the next phase.
- Billing management: `/ops/billing` can be added in the next phase.

If the product should only support Feishu/Lark users, implement Feishu login in `stock2-api` as an auth provider. The same `stock2-web` UI can remain the configuration UI; it just requires a Feishu-authenticated session.
