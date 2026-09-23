#!/bin/sh
cd "$(dirname "$0")" || exit 1
ru() {
  case "$DDNET_AI_LANG" in ru) return 0 ;; en) return 1 ;; esac
  grep -q '"lang": *"ru"' settings.json 2>/dev/null && return 0
  grep -q '"lang": *"en"' settings.json 2>/dev/null && return 1
  case "${LC_ALL:-${LC_MESSAGES:-$LANG}}" in ru*) return 0 ;; esac
  return 1
}
if ru; then
  START="запускаю бота..."
  EXITED="бот вышел. Перезапуск через 5 секунд. Ctrl+C чтобы остановить."
else
  START="starting the bot..."
  EXITED="the bot exited. Restarting in 5 seconds. Ctrl+C to stop."
fi
while true; do
  echo "[$(date '+%F %T')] $START"
  node start.mjs "$@"
  echo "[$(date '+%F %T')] $EXITED"
  sleep 5
done
