#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_PATH="${ROOT_DIR}/.env"
EXAMPLE_PATH="${ROOT_DIR}/.env.example"
LEGACY_PATH="${ROOT_DIR}/upbeat-brahmagupta-1ee9a3/.env"

if [[ -f "${ENV_PATH}" ]]; then
  echo ".env already exists at ${ENV_PATH}"
  exit 0
fi

if [[ -f "${LEGACY_PATH}" ]]; then
  cp "${LEGACY_PATH}" "${ENV_PATH}"
  echo "Created .env from ${LEGACY_PATH}"
  exit 0
fi

cp "${EXAMPLE_PATH}" "${ENV_PATH}"
echo "Created .env from template."
echo "Fill in real values in ${ENV_PATH} before running the pipeline."
