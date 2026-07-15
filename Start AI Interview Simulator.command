#!/bin/zsh

# Portable macOS launcher. Double-click this file from Finder.

set -u

PROJECT_DIR="${0:A:h}"
LOG_DIR="$PROJECT_DIR/.runtime-logs"
FRONTEND_URL="http://127.0.0.1:3001/setup"
BACKEND_URL="http://127.0.0.1:8000/health"

cd "$PROJECT_DIR" || exit 1
mkdir -p "$LOG_DIR"

fail() {
  print "\n启动失败：$1"
  print "\n按任意键关闭窗口。"
  read -k 1
  exit 1
}

command -v node >/dev/null 2>&1 || fail "未找到 Node.js。请先安装 Node.js 20.9 或更高版本：https://nodejs.org/"
command -v npm >/dev/null 2>&1 || fail "未找到 npm。请重新安装 Node.js：https://nodejs.org/"
command -v python3 >/dev/null 2>&1 || fail "未找到 Python 3。请先安装 Python 3.10 或更高版本：https://www.python.org/downloads/"

NODE_MAJOR=$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null)
[[ "$NODE_MAJOR" -ge 20 ]] || fail "Node.js 版本过旧，需要 20.9 或更高版本。"

if [[ ! -f .env ]]; then
  cp .env.example .env || fail "无法创建 .env 配置文件。"
  print "已创建本地配置文件 .env（不会上传到 GitHub）。"
fi

if [[ ! -x .venv/bin/python ]]; then
  print "首次启动：正在创建 Python 环境……"
  python3 -m venv .venv || fail "无法创建 Python 环境。"
fi

if ! .venv/bin/python -c 'import fastapi, uvicorn, dotenv, websockets' >/dev/null 2>&1; then
  print "首次启动：正在安装 Python 依赖……"
  .venv/bin/python -m pip install -r backend/requirements.txt || fail "Python 依赖安装失败，请检查网络后重试。"
fi

if [[ ! -d frontend/node_modules ]]; then
  print "首次启动：正在安装前端依赖……"
  npm --prefix frontend ci || fail "前端依赖安装失败，请检查网络后重试。"
fi

SOURCE_REVISION=$(
  /usr/bin/git -C "$PROJECT_DIR" rev-parse HEAD 2>/dev/null ||
  /usr/bin/find frontend/app frontend/lib backend director reporting -type f -exec /usr/bin/shasum -a 256 {} \; 2>/dev/null | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}'
)
SOURCE_CONFIGURATION=$(/usr/bin/shasum -a 256 "$PROJECT_DIR/.env" 2>/dev/null | /usr/bin/awk '{print $1}')
RUNNING_REVISION=""
RUNNING_CONFIGURATION=""
[[ -f "$LOG_DIR/frontend-revision" ]] && RUNNING_REVISION=$(<"$LOG_DIR/frontend-revision")
[[ -f "$LOG_DIR/runtime-configuration" ]] && RUNNING_CONFIGURATION=$(<"$LOG_DIR/runtime-configuration")

if /usr/bin/curl --silent --fail --max-time 1 "$BACKEND_URL" >/dev/null 2>&1 && \
   /usr/bin/curl --silent --fail --max-time 1 "$FRONTEND_URL" >/dev/null 2>&1 && \
   [[ "$RUNNING_REVISION" == "$SOURCE_REVISION" ]] && \
   [[ "$RUNNING_CONFIGURATION" == "$SOURCE_CONFIGURATION" ]]; then
  /usr/bin/open "$FRONTEND_URL"
  /usr/bin/osascript -l JavaScript -e 'Application("Terminal").hide()' >/dev/null 2>&1 &
  exit 0
fi

stop_port() {
  local pid
  for pid in $(/usr/sbin/lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null); do
    kill "$pid" 2>/dev/null || true
  done
}

stop_port 8000
stop_port 3001
/bin/sleep 1
: >"$LOG_DIR/backend.log"
: >"$LOG_DIR/frontend.log"

print "正在启动 AI Interview Simulator，首次构建可能需要几分钟……"
/usr/bin/nohup npm run start:backend >>"$LOG_DIR/backend.log" 2>&1 </dev/null &
/usr/bin/nohup /bin/zsh -lc "cd '$PROJECT_DIR' && npm run build && printf '%s\\n' '$SOURCE_REVISION' > '$LOG_DIR/frontend-revision' && printf '%s\\n' '$SOURCE_CONFIGURATION' > '$LOG_DIR/runtime-configuration' && npm run start:frontend" >>"$LOG_DIR/frontend.log" 2>&1 </dev/null &

for _ in {1..180}; do
  if /usr/bin/curl --silent --fail --max-time 1 "$BACKEND_URL" >/dev/null 2>&1 && \
     /usr/bin/curl --silent --fail --max-time 1 "$FRONTEND_URL" >/dev/null 2>&1; then
    /usr/bin/open "$FRONTEND_URL"
    /usr/bin/osascript -l JavaScript -e 'Application("Terminal").hide()' >/dev/null 2>&1 &
    exit 0
  fi
  /bin/sleep 1
done

print "\n启动超时。请查看："
print "  $LOG_DIR/backend.log"
print "  $LOG_DIR/frontend.log"
print "\n按任意键关闭窗口。"
read -k 1
exit 1
