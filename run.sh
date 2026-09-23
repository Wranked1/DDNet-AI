#!/bin/bash
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js не найден. Установи Node.js 24 или новее: https://nodejs.org/"
  exit 1
fi
major=$(node -p "process.versions.node.split('.')[0]")
if [ "$major" -lt 24 ]; then
  echo "Нужен Node.js 24 или новее, у тебя $(node -v). Скачать: https://nodejs.org/"
  exit 1
fi
exec node start.mjs "$@"
