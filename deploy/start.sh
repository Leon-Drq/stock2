#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-${SCRIPT_DIR}/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-${SCRIPT_DIR}/docker-compose.yml}"
DB_DIR="${DB_DIR:-${SCRIPT_DIR}/stockdb}"

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose is required." >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  cp "${SCRIPT_DIR}/env/compose.env.sample" "${ENV_FILE}"
  echo "Created ${ENV_FILE} from env/compose.env.sample."
  echo "Review passwords and tokens before using this deployment in production." >&2
fi

mkdir -p "${DB_DIR}"
chmod 700 "${DB_DIR}" || true

if [[ "$(id -u)" == "0" ]]; then
  chown 999:999 "${DB_DIR}" || true
fi

echo "Pulling images..."
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" pull

echo "Starting stock2 services..."
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps
