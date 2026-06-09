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
else
  missing_keys=0
  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ "${line}" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] || continue
    key="${line%%=*}"
    if ! grep -Eq "^${key}=" "${ENV_FILE}"; then
      if [[ "${missing_keys}" -eq 0 ]]; then
        {
          echo
          echo "# Added by start.sh from env/compose.env.sample on $(date -u +%Y-%m-%dT%H:%M:%SZ)"
        } >> "${ENV_FILE}"
      fi
      echo "${line}" >> "${ENV_FILE}"
      missing_keys=$((missing_keys + 1))
    fi
  done < "${SCRIPT_DIR}/env/compose.env.sample"
  if [[ "${missing_keys}" -gt 0 ]]; then
    echo "Added ${missing_keys} missing settings to ${ENV_FILE}. Review newly added values if needed."
  fi
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
