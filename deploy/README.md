# Stock2 Docker Deployment

This deployment is for the `release/test` architecture:

- `stock2-web`: Next.js app on Node.js 24 for the existing product UI and stock workflows.
- `stock2-api`: Python 3.12 FastAPI control plane for database initialization, users, sessions, billing, and cron configuration.
- `stock2-scheduler`: APScheduler worker that executes enabled cron jobs against internal Next.js routes.
- `postgres`: PostgreSQL 18.

## Run Locally

Linux deployment uses the published GHCR images by default:

```bash
cd deploy
chmod +x start.sh stop.sh
./start.sh
```

`start.sh` creates `deploy/.env` from `deploy/env/compose.env.sample` if it is missing, pulls the latest configured images, creates `deploy/stockdb`, and starts the services.

## Build Images Locally

On a Linux machine with the source code:

```bash
cd deploy
chmod +x build.sh
./build.sh
```

By default it builds:

- `ghcr.io/leon-drq/stock2-api:release-test`
- `ghcr.io/leon-drq/stock2-web:release-test`

Override tags or platform with environment variables:

```bash
STOCK2_API_IMAGE=stock2-api:local STOCK2_WEB_IMAGE=stock2-web:local PLATFORM=linux/amd64 ./build.sh
```

Set `PUSH=true` to push instead of loading into the local Docker engine.

Open:

- Web: http://localhost:3000
- Cron configuration: http://localhost:3000/ops/cron
- API health: http://localhost:8000/healthz

The API service runs PostgreSQL migrations on startup. It does not execute Supabase Auth migrations that depend on `auth.uid()`.

## Environment

Compose-level settings live in:

- `deploy/.env`: real local deployment file, ignored by Git
- `deploy/env/compose.env.sample`: sample for Docker Compose

Service-specific reference samples live in `deploy/env/` for platforms that manage each container separately.

Defaults:

- Web image: `ghcr.io/leon-drq/stock2-web:release-test`
- API and scheduler image: `ghcr.io/leon-drq/stock2-api:release-test`
- Docker network subnet: `10.15.11.0/24`
- PostgreSQL data path: `deploy/stockdb`

Default model configuration:

```env
MODEL_PROVIDER_KEY=your-provider-key
DEFAULT_MODEL_PROVIDER=deepseek
DEFAULT_MODEL_NAME=deepseek-v4-flash
```

Supported provider/model examples:

- `deepseek`: `deepseek-v4-flash`, `deepseek-v4-pro`
- `openai`: `gpt-4o-mini`, `gpt-4.1-mini`, `gpt-4.1`
- `kimi`: `moonshot-v1-8k`, `moonshot-v1-32k`, `moonshot-v1-128k`
- `qwen`: `qwen-plus`, `qwen-max`, `qwen-turbo`

`MODEL_PROVIDER_KEY` is the preferred single key variable for the selected default provider. Legacy provider-specific variables such as `DEEPSEEK_API_KEY` and `OPENAI_API_KEY` remain supported as fallback.

If PostgreSQL reports a permission problem on `stockdb`, run:

```bash
sudo chown -R 999:999 deploy/stockdb
sudo chmod 700 deploy/stockdb
```

For rootful Docker this is usually handled automatically by the official Postgres entrypoint. Rootless Docker may need the manual ownership step.

## Stop

```bash
cd deploy
./stop.sh
```

## Nginx Reverse Proxy

For a normal deployment, Nginx only needs to proxy `stock2-web` on port `3000`.

Example:

```nginx
server {
    listen 80;
    server_name stock.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

`stock2-api` does not need to be proxied publicly. The configuration page at `/ops/cron` calls the same-origin Next.js route `/api/control/*`, and `stock2-web` forwards that request to `stock2-api` through the Docker network:

```env
PYTHON_API_URL=http://stock2-api:8000
```

The scheduler also stays internal. It reads cron configuration from PostgreSQL and calls `stock2-web` through:

```env
NEXT_INTERNAL_BASE_URL=http://stock2-web:3000
```

Keep `INTERNAL_CRON_TOKEN` and `CRON_SECRET` identical. No Nginx route is needed for scheduler traffic.

If you do not want the API reachable from the host, remove or comment the `API_PORT` mapping in `docker-compose.yml`. Health checks and internal service communication will still work inside the Docker network.

## Cron

Cron jobs are stored in `cron_jobs` and executed by `stock2-scheduler`.

The scheduler calls Next.js routes through the internal Docker network and sends:

```http
Authorization: Bearer ${INTERNAL_CRON_TOKEN}
```

The Next.js app maps that value to `CRON_SECRET`.

## Images

The GitHub Actions workflow builds:

- `Docker Web Image`: builds `ghcr.io/leon-drq/stock2-web:release-test`
- `Docker API Image`: builds `ghcr.io/leon-drq/stock2-api:release-test`

The scheduler reuses the API image and has no separate image.

See `deploy/ARCHITECTURE.md` for container responsibilities and scheduler communication.
