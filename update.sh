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
  M_START="Обновляю бота из GitHub (Wranked1/DDNet-AI)..."; M_GET="не скачалось"; M_UNPACK="не распаковалось"; M_DONE="Готово. Запускай ./run.sh"
else
  M_START="Updating the bot from GitHub (Wranked1/DDNet-AI)..."; M_GET="download failed"; M_UNPACK="could not unpack"; M_DONE="Done. Start it with ./run.sh"
fi
echo "$M_START"
rm -rf update-tmp && mkdir update-tmp || exit 1
TOKEN="${GITHUB_TOKEN:-$(cat update-token.txt 2>/dev/null)}"
if [ -z "$TOKEN" ]; then
  curl -fL -o update-tmp/src.zip https://github.com/Wranked1/DDNet-AI/archive/refs/heads/main.zip || { echo "$M_GET"; rm -rf update-tmp; exit 1; }
else
  curl -fL -H "Authorization: Bearer $TOKEN" -o update-tmp/src.zip https://api.github.com/repos/Wranked1/AiDDNet/zipball/main || { echo "$M_GET"; rm -rf update-tmp; exit 1; }
fi
( cd update-tmp && unzip -q src.zip ) || { echo "$M_UNPACK"; rm -rf update-tmp; exit 1; }
inner=$(find update-tmp -mindepth 1 -maxdepth 1 -type d | head -1)
cp -r "$inner/src/." src/
[ -d "$inner/tools" ] && mkdir -p tools && cp -r "$inner/tools/." tools/
[ -d "$inner/app" ] && mkdir -p app && cp -r "$inner/app/." app/
[ -f "$inner/DDNet AI.vbs" ] && cp "$inner/DDNet AI.vbs" .
cp "$inner/start.mjs" "$inner/package.json" .
[ -f "$inner/opponent.json" ] && cp "$inner/opponent.json" .
[ -f "$inner/README.md" ] && cp "$inner/README.md" .
[ -f "$inner/README.en.md" ] && cp "$inner/README.en.md" .
rm -rf update-tmp
echo "$M_DONE"
