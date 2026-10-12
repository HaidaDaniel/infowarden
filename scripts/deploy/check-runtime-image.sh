#!/usr/bin/env bash
set -euo pipefail

image="${1:-}"
root_path="${2:-/app}"

if [[ -z "$image" ]]; then
  echo "usage: scripts/deploy/check-runtime-image.sh <image> [root_path]" >&2
  exit 2
fi

docker run --rm --entrypoint /bin/sh "$image" -c "
  set -eu
  cd '$root_path'
  for path in .env .env.local .git .agentic .tasks src test tests coverage test-results playwright-report .contextforge; do
    if [ -e \"\$path\" ]; then
      echo \"forbidden runtime artifact present: \$path\" >&2
      exit 1
    fi
  done
  if find . -path './node_modules' -prune -o \( -name '*.spec.*' -o -name '*.test.*' -o -name '*.tsbuildinfo' \) -print | grep -q .; then
    echo 'forbidden test/build metadata artifact present' >&2
    exit 1
  fi
"
