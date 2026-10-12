#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./dev-common.sh
source "$SCRIPT_DIR/dev-common.sh"

require_cmd pnpm
ensure_repo_root
load_repo_env

exec pnpm --filter api start:dev "$@"
