#!/bin/zsh

# Double-click in Finder. Terminal launches the services (so macOS Documents
# permissions work), then this script immediately hides Terminal and opens only
# the browser page.

set -u

PROJECT_DIR="/Users/luzifeng/Documents/interview"
LOG_DIR="$PROJECT_DIR/.runtime-logs"
FRONTEND_URL="http://127.0.0.1:3001/setup"
BACKEND_URL="http://127.0.0.1:8000/health"

cd "$PROJECT_DIR" || exit 1
mkdir -p "$LOG_DIR"
SOURCE_REVISION=$(/usr/bin/git -C "$PROJECT_DIR" rev-parse HEAD 2>/dev/null || /bin/date +%s)
RUNNING_REVISION=""
if [[ -f "$LOG_DIR/frontend-revision" ]]; then
  RUNNING_REVISION=$(<"$LOG_DIR/frontend-revision")
fi

# Reuse a healthy local instance. Double-clicking the launcher during an active
# interview must not destroy the in-memory Director session. A committed source
# update deliberately invalidates that reuse so users never keep seeing an old
# Next.js server after installing a fix.
if /usr/bin/curl --silent --fail --max-time 1 "$BACKEND_URL" >/dev/null 2>&1 && \
   /usr/bin/curl --silent --fail --max-time 1 "$FRONTEND_URL" >/dev/null 2>&1 && \
   [[ "$RUNNING_REVISION" == "$SOURCE_REVISION" ]]; then
  /usr/bin/open "$FRONTEND_URL"
  /usr/bin/osascript -l JavaScript -e 'Application("Terminal").hide()' >/dev/null 2>&1 &
  exit 0
fi

stop_port() {
  local port="$1"
  local pid

  for pid in $(/usr/sbin/lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null); do
    kill "$pid" 2>/dev/null || true
  done
}

# A partial or unhealthy local instance is restarted as one coherent pair.
stop_port 8000
stop_port 3001
/bin/sleep 1

: >"$LOG_DIR/backend.log"
: >"$LOG_DIR/frontend.log"

/usr/bin/nohup npm run start:backend >>"$LOG_DIR/backend.log" 2>&1 </dev/null &
/usr/bin/nohup /bin/zsh -lc "cd '$PROJECT_DIR' && npm run build && printf '%s\\n' '$SOURCE_REVISION' > '$LOG_DIR/frontend-revision' && npm run start:frontend" >>"$LOG_DIR/frontend.log" 2>&1 </dev/null &

# Wait separately so Terminal can disappear immediately.
(
  for _ in {1..60}; do
    if /usr/bin/curl --silent --fail --max-time 1 "$BACKEND_URL" >/dev/null 2>&1 && \
       /usr/bin/curl --silent --fail --max-time 1 "$FRONTEND_URL" >/dev/null 2>&1; then
      /usr/bin/open "$FRONTEND_URL"
      break
    fi
    /bin/sleep 1
  done
) >/dev/null 2>&1 &

# This uses JavaScript for Automation rather than AppleScript, avoiding the
# localized AppleScript command issue encountered on this Mac.
/usr/bin/osascript -l JavaScript -e 'Application("Terminal").hide()' >/dev/null 2>&1 &

exit 0
