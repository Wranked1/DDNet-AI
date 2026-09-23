#!/bin/bash
cd "$(dirname "$0")" || exit 1
ru() {
  case "$DDNET_AI_LANG" in ru) return 0 ;; en) return 1 ;; esac
  grep -q '"lang": *"ru"' settings.json 2>/dev/null && return 0
  grep -q '"lang": *"en"' settings.json 2>/dev/null && return 1
  case "${LC_ALL:-${LC_MESSAGES:-$LANG}}" in ru*) return 0 ;; esac
  return 1
}
if ! command -v node >/dev/null 2>&1; then
  if ru; then echo "Node.js не найден. Установи Node.js 24 или новее: https://nodejs.org/"; else echo "Node.js was not found. Install Node.js 24 or newer: https://nodejs.org/"; fi
  exit 1
fi
major=$(node -p "process.versions.node.split('.')[0]")
if [ "$major" -lt 24 ]; then
  if ru; then echo "Нужен Node.js 24 или новее, у тебя $(node -v). Скачать: https://nodejs.org/"; else echo "Node.js 24 or newer is needed, this is $(node -v). Download: https://nodejs.org/"; fi
  exit 1
fi
exec node start.mjs "$@"
