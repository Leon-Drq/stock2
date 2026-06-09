# Service env samples

These files document the recommended configuration for each container.

- `compose.env.sample`: Docker Compose settings, including PostgreSQL credentials, ports, image names, and network subnet.
- `stock2-api.env.sample`: Python FastAPI service settings, including database initialization, sessions, admin bootstrap, and CORS.
- `stock2-scheduler.env.sample`: APScheduler worker settings. Tokens must match `stock2-api`.
- `stock2-web.env.sample`: Next.js service settings and the internal Python API URL.

For local Docker Compose, run `deploy/start.sh`. It creates `deploy/.env` from `compose.env.sample` when needed.

The per-service samples are reference files for production platforms that manage service env separately.
