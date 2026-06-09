# Stock2 Docker Deployment

This deployment is for the `release/test` architecture:

- `stock2-web`: Next.js app on Node.js 24 for the existing product UI and stock workflows.
- `stock2-api`: Python 3.12 FastAPI control plane for database initialization, users, sessions, billing, and cron configuration.
- `stock2-scheduler`: APScheduler worker that executes enabled cron jobs against internal Next.js routes.
- `postgres`: PostgreSQL 18.

## Run Locally

```bash
cp deploy/.env.example deploy/.env
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up --build
```

Open:

- Web: http://localhost:3000
- Cron configuration: http://localhost:3000/ops/cron
- API health: http://localhost:8000/healthz

The API service runs PostgreSQL migrations on startup. It does not execute Supabase Auth migrations that depend on `auth.uid()`.

Service-specific environment samples live in `deploy/env/`. Use `deploy/.env.example` for local Docker Compose, and use the per-service samples when deploying each container separately.

## Cron

Cron jobs are stored in `cron_jobs` and executed by `stock2-scheduler`.

The scheduler calls Next.js routes through the internal Docker network and sends:

```http
Authorization: Bearer ${INTERNAL_CRON_TOKEN}
```

The Next.js app maps that value to `CRON_SECRET`.

## Images

The GitHub Actions workflow builds:

- `Docker Web Image`: builds `ghcr.io/leon-drq/stock2-web`
- `Docker API Image`: builds `ghcr.io/leon-drq/stock2-api`

The scheduler reuses the API image and has no separate image.

See `deploy/ARCHITECTURE.md` for container responsibilities and scheduler communication.
