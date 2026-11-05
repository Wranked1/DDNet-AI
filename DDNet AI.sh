#!/bin/sh
here=$(dirname "$(readlink -f "$0")")
cd "$here" || exit 1
ru() {
  case "$DDNET_AI_LANG" in ru) return 0 ;; en) return 1 ;; esac
  grep -q '"lang": *"ru"' settings.json 2>/dev/null && return 0
  grep -q '"lang": *"en"' settings.json 2>/dev/null && return 1
  case "${LC_ALL:-${LC_MESSAGES:-$LANG}}" in ru*) return 0 ;; esac
  return 1
}
say() {
  if ru; then msg=$1; else msg=$2; fi
  echo "$msg" >&2
  [ -n "$DDNET_AI_NO_NOTIFY" ] || ! command -v notify-send >/dev/null 2>&1 || notify-send "DDNet AI" "$msg" 2>/dev/null
  return 0
}

if [ "$1" = "--install-desktop" ]; then
  case $here in *[\\\"\$\`]*) say "В пути есть спецсимволы (\\ \" \$ \`), переименуй папку." "The path has special characters (\\ \" \$ \`), rename the folder."; exit 1 ;; esac
  data=${XDG_DATA_HOME:-$HOME/.local/share}
  mkdir -p "$data/applications" "$data/icons/hicolor/256x256/apps" || exit 1
  cp app/icons/app-256.png "$data/icons/hicolor/256x256/apps/ddnet-ai.png" || exit 1
  {
    echo "[Desktop Entry]"
    echo "Type=Application"
    echo "Name=DDNet AI"
    echo "Comment=Bot for DDNet"
    echo "Exec=\"$(printf '%s' "$here/DDNet AI.sh" | sed 's/%/%%/g')\""
    echo "Path=$here"
    echo "Icon=ddnet-ai"
    echo "Terminal=false"
    echo "Categories=Game;"
    echo "StartupWMClass=ddnet-ai"
  } > "$data/applications/ddnet-ai.desktop" || exit 1
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$data/applications" 2>/dev/null
  say "DDNet AI добавлен в меню приложений." "DDNet AI was added to the applications menu."
  exit 0
fi

bin="$here/app-linux/ddnet-ai"
if [ ! -x "$bin" ]; then
  say "Окно не найдено (app-linux/ddnet-ai), запускаю ./run.sh в консоли. Окно ставится из ddnet-ai-linux.tar.gz." "The window was not found (app-linux/ddnet-ai), starting ./run.sh in the console. The window comes with ddnet-ai-linux.tar.gz."
  exec ./run.sh "$@"
fi

need=$(sed -n 's/.*"electron"[[:space:]]*:[[:space:]]*"\([0-9][0-9.]*\)".*/\1/p' app/package.json 2>/dev/null | head -n 1)
have=$(tr -d '\r\n ' < app-linux/.installed 2>/dev/null)
if [ -n "$need" ] && [ "$need" != "$have" ]; then
  case $(uname -m) in aarch64|arm64) plat=linux-arm64 ;; *) plat=linux-x64 ;; esac
  say "Ставлю окно (Electron $need, около 120 МБ)..." "Installing the window (Electron $need, about 120 MB)..."
  if [ -f tools/packageApp.mjs ] && ELECTRON_RUN_AS_NODE=1 "$bin" tools/packageApp.mjs --install --platform "$plat"; then
    :
  else
    say "Окно не обновилось: скачай новый ddnet-ai-linux.tar.gz." "The window could not be updated: download the new ddnet-ai-linux.tar.gz."
  fi
fi

sandbox=
if [ -z "$DDNET_AI_SANDBOX" ] && ! [ -u app-linux/chrome-sandbox ] && ! unshare --user --map-root-user --pid --fork true >/dev/null 2>&1; then
  sandbox=--no-sandbox
fi
[ "$DDNET_AI_SANDBOX" = 0 ] && sandbox=--no-sandbox
[ -n "$ELECTRON_OZONE_PLATFORM_HINT" ] || export ELECTRON_OZONE_PLATFORM_HINT=auto
exec "$bin" $sandbox "$@"
