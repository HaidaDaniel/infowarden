#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${CONTEXTFORGE_HEAVY_ENV_FILE:-$REPO_ROOT/.env.heavy.local}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "heavy dev env is missing at $ENV_FILE" >&2
  echo "Create .env.heavy.local or set CONTEXTFORGE_HEAVY_ENV_FILE." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

exec bash "$SCRIPT_DIR/dev-stack.sh" "$@"
