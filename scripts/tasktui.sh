#!/usr/bin/env bash
# Linux launcher: starts the tasktui server in the background if needed, then opens the app.
#   scripts/tasktui.sh            start + open the app window
#   scripts/tasktui.sh --capture  start + open the small quick-capture window
#   scripts/tasktui.sh --no-open  start only
#   scripts/tasktui.sh --stop     stop the server
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${TASKTUI_PORT:-8765}"
URL="http://localhost:$PORT"
LOG="${XDG_CACHE_HOME:-$HOME/.cache}/tasktui.log"

running() { curl -fs --max-time 1 "$URL/api/ping" 2>/dev/null | grep -q '"tasktui"'; }

case "${1:-}" in
--stop)
  pid=$(ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K\d+' | head -1 || true)
  if [[ -n "$pid" ]]; then kill "$pid" && echo "tasktui stopped."; else echo "tasktui is not running."; fi
  exit 0
  ;;
esac

if ! running; then
  # Desktop keybindings may not have the shell's PATH (mise, nvm...).
  NODE="$(command -v node || true)"
  [[ -z "$NODE" && -x "$HOME/.local/share/mise/shims/node" ]] && NODE="$HOME/.local/share/mise/shims/node"
  [[ -z "$NODE" ]] && { notify-send "tasktui" "Node.js not found" 2>/dev/null; echo "Node.js not found" >&2; exit 1; }
  mkdir -p "$(dirname "$LOG")"
  (cd "$ROOT" && setsid "$NODE" dist/server.js >>"$LOG" 2>&1 &)
  for _ in $(seq 40); do running && break; sleep 0.25; done
  running || { notify-send "tasktui" "Server did not start, see $LOG" 2>/dev/null; exit 1; }
fi

open_app() {
  if command -v omarchy-launch-webapp >/dev/null; then
    omarchy-launch-webapp "$@"
  else
    setsid chromium --app="$1" "${@:2}" >/dev/null 2>&1 &
  fi
}

case "${1:-}" in
--no-open) ;;
--capture) open_app "$URL/capture" ;;
*) open_app "$URL" ;;
esac
