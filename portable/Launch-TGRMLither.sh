#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required for the local launcher." >&2
  echo "You can still open index.html directly, but browser storage/offline features may be limited." >&2
  exit 1
fi
URL="http://127.0.0.1:8765/"
python3 -m http.server 8765 --bind 127.0.0.1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
sleep 1
if command -v open >/dev/null 2>&1; then
  open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL"
elif command -v gio >/dev/null 2>&1; then
  gio open "$URL"
else
  printf 'Open this URL in your browser: %s\n' "$URL"
fi
wait "$SERVER_PID"
