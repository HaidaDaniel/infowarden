#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    return 1
  fi
}

require_docker_compose() {
  require_cmd docker

  if ! docker compose version >/dev/null 2>&1; then
    echo "docker compose is unavailable. Install Docker Compose v2 or enable the compose plugin." >&2
    return 1
  fi

  if ! docker info >/dev/null 2>&1; then
    echo "docker daemon is unavailable. Start Docker and retry." >&2
    return 1
  fi
}

ensure_repo_root() {
  cd "$REPO_ROOT"
}

load_repo_env() {
  local env_file="${1:-$REPO_ROOT/.env}"
  local original_entry=""
  local -a original_env=()

  if [[ ! -f "$env_file" ]]; then
    echo ".env is missing at $env_file" >&2
    echo "Copy .env.example to .env before starting the development API." >&2
    return 1
  fi

  while IFS= read -r -d '' original_entry; do
    original_env+=("$original_entry")
  done < <(env -0)

  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a

  for original_entry in "${original_env[@]}"; do
    export "${original_entry}"
  done
}

wait_for_container_health() {
  local container_name="$1"
  local label="$2"
  local timeout_seconds="${3:-60}"
  local deadline=$((SECONDS + timeout_seconds))
  local status=""

  while (( SECONDS < deadline )); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_name" 2>/dev/null || true)"
    if [[ "$status" == "healthy" ]]; then
      return 0
    fi
    sleep 2
  done

  echo "$label did not become healthy within ${timeout_seconds}s." >&2
  docker compose ps >&2 || true
  return 1
}

wait_for_http_ok() {
  local url="$1"
  local label="$2"
  local timeout_seconds="${3:-60}"
  local deadline=$((SECONDS + timeout_seconds))

  while (( SECONDS < deadline )); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  echo "$label did not respond successfully within ${timeout_seconds}s: $url" >&2
  return 1
}

url_hostname() {
  local url="$1"
  node -e '
const input = process.argv[1] || "";
try {
  process.stdout.write(new URL(input).hostname || "");
} catch {
  process.stdout.write("");
}
' "$url"
}

url_port() {
  local url="$1"
  local fallback="$2"
  node -e '
const input = process.argv[1] || "";
const fallback = process.argv[2] || "";
try {
  const parsed = new URL(input);
  process.stdout.write(parsed.port || fallback);
} catch {
  process.stdout.write(fallback);
}
' "$url" "$fallback"
}

is_local_host() {
  local host="${1:-}"
  [[ -z "$host" || "$host" == "localhost" || "$host" == "127.0.0.1" || "$host" == "::1" ]]
}

free_dev_ports() {
  local -a ports=()
  local port=""
  for port in "$@"; do
    if [[ -n "$port" && "$port" =~ ^[0-9]+$ ]]; then
      ports+=("$port")
    fi
  done

  if [[ "${#ports[@]}" -eq 0 ]]; then
    return 0
  fi

  mapfile -t ports < <(printf '%s\n' "${ports[@]}" | awk '!seen[$0]++')

  if [[ "${DEV_AUTO_FREE_PORTS:-0}" != "1" ]]; then
    echo "== Dev port cleanup disabled by default (DEV_AUTO_FREE_PORTS=0)"
    assert_dev_ports_free "${ports[@]}"
    return $?
  fi

  echo "== Freeing dev ports: ${ports[*]}"
  echo "== DEV_AUTO_FREE_PORTS=1 set; exact Docker/process targets will be printed before stopping"

  stop_docker_port_conflicts "${ports[@]}"
  stop_user_port_processes "${ports[@]}"
  assert_dev_ports_free "${ports[@]}"
}

stop_docker_port_conflicts() {
  local port=""
  local containers=""
  local container_names=""

  for port in "$@"; do
    containers="$(docker ps --filter "publish=${port}" --format '{{.ID}}' || true)"
    if [[ -z "$containers" ]]; then
      continue
    fi

    container_names="$(docker ps --filter "publish=${port}" --format '{{.Names}}' | paste -sd ', ' -)"
    echo "Stopping Docker containers using port ${port}: ${container_names}"
    # shellcheck disable=SC2086
    docker stop $containers >/dev/null
  done
}

stop_user_port_processes() {
  if ! command -v lsof >/dev/null 2>&1; then
    echo "lsof is unavailable; skipping host process port cleanup." >&2
    return 0
  fi

  local current_user
  current_user="$(id -un)"
  local port=""
  local pids=""
  local pid=""
  local owner=""
  local command_name=""

  for port in "$@"; do
    pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -z "$pids" ]]; then
      continue
    fi

    for pid in $pids; do
      owner="$(ps -o user= -p "$pid" 2>/dev/null | awk '{print $1}')"
      command_name="$(ps -o comm= -p "$pid" 2>/dev/null | awk '{print $1}')"
      if [[ "$owner" == "$current_user" || "${DEV_KILL_FOREIGN_PORT_PROCESSES:-0}" == "1" ]]; then
        echo "Stopping host process on port ${port}: pid=${pid} user=${owner:-unknown} cmd=${command_name:-unknown}"
        kill "$pid" 2>/dev/null || true
      else
        echo "Port ${port} is held by pid=${pid} user=${owner:-unknown} cmd=${command_name:-unknown}; not killing a foreign/system process." >&2
      fi
    done
  done

  sleep 1

  for port in "$@"; do
    pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -z "$pids" ]]; then
      continue
    fi

    for pid in $pids; do
      owner="$(ps -o user= -p "$pid" 2>/dev/null | awk '{print $1}')"
      if [[ "$owner" == "$current_user" || "${DEV_KILL_FOREIGN_PORT_PROCESSES:-0}" == "1" ]]; then
        kill -9 "$pid" 2>/dev/null || true
      fi
    done
  done
}

assert_dev_ports_free() {
  if ! command -v lsof >/dev/null 2>&1; then
    return 0
  fi

  local port=""
  local blocked=0
  local details=""

  for port in "$@"; do
    details="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$details" ]]; then
      echo "Port ${port} is still busy:" >&2
      echo "$details" >&2
      blocked=1
    fi
  done

  if [[ "$blocked" == "1" ]]; then
    echo "Stop the processes above, or rerun with DEV_AUTO_FREE_PORTS=1 to let dev startup stop same-user targets after printing them." >&2
    echo "Use DEV_KILL_FOREIGN_PORT_PROCESSES=1 only when you intentionally want dev startup to kill foreign/system processes too." >&2
    return 1
  fi
}
