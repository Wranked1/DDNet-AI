#!/bin/sh
cd "$(dirname "$0")" || exit 1
while true; do
  echo "[$(date '+%F %T')] запускаю бота..."
  node start.mjs "$@"
  echo "[$(date '+%F %T')] бот вышел. Перезапуск через 5 секунд. Ctrl+C чтобы остановить."
  sleep 5
done
