#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required for the local launcher." >&2
  echo "You can still open index.html directly, but browser storage/offline features may be limited." >&2
  exit 1
fi

URL="http://127.0.0.1:8765/"
if python3 -c 'import socket,sys; s=socket.socket(); s.settimeout(.25); r=s.connect_ex(("127.0.0.1",8765)); s.close(); sys.exit(0 if r==0 else 1)' >/dev/null 2>&1; then
  echo "Port 8765 is already in use. Close the other local server and try again." >&2
  exit 1
fi

python3 -m http.server 8765 --bind 127.0.0.1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

READY=0
ATTEMPT=0
while [ "$ATTEMPT" -lt 20 ]; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "The local server failed to start. Check whether port 8765 is available." >&2
    exit 1
  fi
  if python3 -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8765/", timeout=.5).read(1)' >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.25
  ATTEMPT=$((ATTEMPT+1))
done
if [ "$READY" -ne 1 ]; then
  echo "The local server did not respond on port 8765." >&2
  exit 1
fi

if command -v open >/dev/null 2>&1; then
  open "$URL" || printf 'Could not open the browser automatically. Open: %s\n' "$URL"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" || printf 'Could not open the browser automatically. Open: %s\n' "$URL"
elif command -v gio >/dev/null 2>&1; then
  gio open "$URL" || printf 'Could not open the browser automatically. Open: %s\n' "$URL"
else
  printf 'Open this URL in your browser: %s\n' "$URL"
fi
wait "$SERVER_PID"
