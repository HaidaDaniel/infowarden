#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./dev-common.sh
source "$SCRIPT_DIR/dev-common.sh"

ensure_repo_root
load_repo_env

# This preset intentionally wins over provider-mode values loaded from .env.
export DEV_USE_EXTERNAL_PROVIDER=0
export DEV_START_LOCAL_EMBEDDINGS=1
export DEV_START_LOCAL_RERANKER=0
export DEV_REGISTER_LOCAL_PROVIDERS=1
export DEV_REGISTER_EXTERNAL_PROVIDERS=0
export DEV_PRUNE_LOCAL_PROVIDER_CONFIGS=0
export DEV_EMBEDDING_PROVIDER_NAME=local-dev-embeddings

exec bash "$SCRIPT_DIR/dev-stack.sh" "$@"
