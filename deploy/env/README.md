# Service env samples

These files document the recommended configuration for each container.

- `postgres.env.sample`: PostgreSQL 18 database settings.
- `stock2-api.env.sample`: Python FastAPI service settings, including database initialization, sessions, admin bootstrap, and CORS.
- `stock2-scheduler.env.sample`: APScheduler worker settings. Tokens must match `stock2-api`.
- `stock2-web.env.sample`: Next.js service settings and the internal Python API URL.

For local Docker Compose, copy `deploy/.env.example` to `deploy/.env` and edit it. The per-service samples are reference files for production platforms that manage service env separately.
