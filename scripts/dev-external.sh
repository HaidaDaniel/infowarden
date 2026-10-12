#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./dev-common.sh
source "$SCRIPT_DIR/dev-common.sh"

ensure_repo_root
load_repo_env

if [[ -z "${EMBEDDING_BASE_URL:-}" || -z "${EMBEDDING_MODEL:-}" ]]; then
  echo "dev:external requires EMBEDDING_BASE_URL and EMBEDDING_MODEL in .env or the caller environment." >&2
  exit 1
fi
if [[ ! "${EMBEDDING_DIMENSION:-}" =~ ^[1-9][0-9]*$ ]]; then
  echo "dev:external requires a positive integer EMBEDDING_DIMENSION." >&2
  exit 1
fi

# This preset intentionally wins over provider-mode values loaded from .env.
export DEV_USE_EXTERNAL_PROVIDER=1
export DEV_START_LOCAL_EMBEDDINGS=0
export DEV_START_LOCAL_RERANKER=0
export DEV_REGISTER_LOCAL_PROVIDERS=0
export DEV_REGISTER_EXTERNAL_PROVIDERS=1
export DEV_PRUNE_LOCAL_PROVIDER_CONFIGS=0
export DEV_EMBEDDING_PROVIDER_NAME="${DEV_EMBEDDING_PROVIDER_NAME:-external-dev-embeddings}"

exec bash "$SCRIPT_DIR/dev-stack.sh" "$@"
