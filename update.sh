#!/bin/sh
cd "$(dirname "$0")" || exit 1
echo "Обновляю бота из GitHub (Wranked1/DDNet-AI)..."
rm -rf update-tmp && mkdir update-tmp || exit 1
TOKEN="${GITHUB_TOKEN:-$(cat update-token.txt 2>/dev/null)}"
if [ -z "$TOKEN" ]; then
  curl -fL -o update-tmp/src.zip https://github.com/Wranked1/DDNet-AI/archive/refs/heads/main.zip || { echo "не скачалось"; rm -rf update-tmp; exit 1; }
else
  curl -fL -H "Authorization: Bearer $TOKEN" -o update-tmp/src.zip https://api.github.com/repos/Wranked1/AiDDNet/zipball/main || { echo "не скачалось"; rm -rf update-tmp; exit 1; }
fi
( cd update-tmp && unzip -q src.zip ) || { echo "не распаковалось"; rm -rf update-tmp; exit 1; }
inner=$(find update-tmp -mindepth 1 -maxdepth 1 -type d | head -1)
cp -r "$inner/src/." src/
[ -d "$inner/tools" ] && mkdir -p tools && cp -r "$inner/tools/." tools/
[ -d "$inner/app" ] && mkdir -p app && cp -r "$inner/app/." app/
[ -f "$inner/DDNet AI.vbs" ] && cp "$inner/DDNet AI.vbs" .
cp "$inner/start.mjs" "$inner/package.json" .
[ -f "$inner/opponent.json" ] && cp "$inner/opponent.json" .
[ -f "$inner/README.md" ] && cp "$inner/README.md" .
rm -rf update-tmp
echo "Готово. Запускай ./run.sh"
