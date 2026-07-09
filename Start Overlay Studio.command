#!/bin/bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
URL="http://127.0.0.1:5173/"

cd "$PROJECT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  osascript -e 'display dialog "未找到 npm。请先安装 Node.js 后再启动 Overlay Studio。" buttons {"OK"} default button "OK"'
  exit 1
fi

if [ ! -d "node_modules" ]; then
  npm install
fi

if lsof -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
  open "$URL"
  exit 0
fi

(sleep 2 && open "$URL") &
npm run local
