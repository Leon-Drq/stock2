#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-${SCRIPT_DIR}/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-${SCRIPT_DIR}/docker-compose.yml}"

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose is required." >&2
  exit 1
fi

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" down "$@"
