#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ENV_FILE:-${SCRIPT_DIR}/.env}"
SAMPLE_ENV_FILE="${SCRIPT_DIR}/env/compose.env.sample"

if ! docker buildx version >/dev/null 2>&1; then
  echo "docker buildx is required." >&2
  exit 1
fi

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
elif [[ -f "${SAMPLE_ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${SAMPLE_ENV_FILE}"
  set +a
fi

STOCK2_API_IMAGE="${STOCK2_API_IMAGE:-ghcr.io/leon-drq/stock2-api:release-test}"
STOCK2_WEB_IMAGE="${STOCK2_WEB_IMAGE:-ghcr.io/leon-drq/stock2-web:release-test}"
PLATFORM="${PLATFORM:-linux/amd64}"
PUSH="${PUSH:-false}"

BUILD_ARGS=(--platform "${PLATFORM}")
if [[ "${PUSH}" == "true" ]]; then
  BUILD_ARGS+=(--push)
else
  BUILD_ARGS+=(--load)
fi

echo "Building ${STOCK2_API_IMAGE}..."
docker buildx build \
  "${BUILD_ARGS[@]}" \
  -f "${SCRIPT_DIR}/Dockerfile.api" \
  -t "${STOCK2_API_IMAGE}" \
  "${REPO_ROOT}"

echo "Building ${STOCK2_WEB_IMAGE}..."
docker buildx build \
  "${BUILD_ARGS[@]}" \
  -f "${SCRIPT_DIR}/Dockerfile.web" \
  -t "${STOCK2_WEB_IMAGE}" \
  "${REPO_ROOT}"

echo "Done."
