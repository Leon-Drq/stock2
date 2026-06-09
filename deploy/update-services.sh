#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-${SCRIPT_DIR}/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-${SCRIPT_DIR}/docker-compose.yml}"
SERVICES=(stock2-api stock2-web stock2-scheduler)

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose is required." >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  cp "${SCRIPT_DIR}/env/compose.env.sample" "${ENV_FILE}"
  echo "Created ${ENV_FILE} from env/compose.env.sample."
  echo "Review passwords, tokens, and image tags before running again." >&2
  exit 1
fi

compose() {
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

container_id() {
  compose ps -q "$1" 2>/dev/null || true
}

container_image_id() {
  local cid
  cid="$(container_id "$1")"
  if [[ -z "${cid}" ]]; then
    echo ""
    return
  fi
  docker inspect -f '{{.Image}}' "${cid}" 2>/dev/null || true
}

declare -A BEFORE_CONTAINERS=()
declare -A BEFORE_IMAGES=()
for service in "${SERVICES[@]}"; do
  BEFORE_CONTAINERS["${service}"]="$(container_id "${service}")"
  BEFORE_IMAGES["${service}"]="$(container_image_id "${service}")"
done

echo "Pulling application images only: ${SERVICES[*]}"
compose pull "${SERVICES[@]}"

echo "Applying image updates without restarting postgres..."
compose up -d --no-deps "${SERVICES[@]}"

echo
echo "Update result:"
for service in "${SERVICES[@]}"; do
  after_container="$(container_id "${service}")"
  after_image="$(container_image_id "${service}")"
  before_container="${BEFORE_CONTAINERS[${service}]}"
  before_image="${BEFORE_IMAGES[${service}]}"

  if [[ -z "${before_container}" && -n "${after_container}" ]]; then
    echo "- ${service}: started"
  elif [[ "${before_container}" != "${after_container}" ]]; then
    echo "- ${service}: restarted with updated image"
  elif [[ "${before_image}" != "${after_image}" ]]; then
    echo "- ${service}: image changed"
  else
    echo "- ${service}: unchanged"
  fi
done

echo
compose ps "${SERVICES[@]}"
