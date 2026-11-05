export const DEFAULT_PLATFORM = "win32-x64";

export const PLATFORMS = {
  "win32-x64": { dir: "app-win", exe: "DDNet AI.exe", electronBin: "electron.exe", launcher: "DDNet AI.vbs" },
  "linux-x64": { dir: "app-linux", exe: "ddnet-ai", electronBin: "electron", launcher: "DDNet AI.sh" },

  "linux-arm64": { dir: "app-linux", exe: "ddnet-ai", electronBin: "electron", launcher: "DDNet AI.sh" },
};

const ALIASES = { win: "win32-x64", win32: "win32-x64", windows: "win32-x64", linux: "linux-x64", arm64: "linux-arm64" };

export const isLinux = (platform) => platform.startsWith("linux-");

export function resolvePlatform(value) {
  if (value === undefined) return DEFAULT_PLATFORM;
  if (value === "" || value === "true") return null;
  const v = String(value).toLowerCase();
  const key = ALIASES[v] ?? v;
  return Object.hasOwn(PLATFORMS, key) ? key : null;
}

export function electronZipName(version, platform) {
  return `electron-v${version}-${platform}.zip`;
}

export function partialPattern(platform) {
  const dir = PLATFORMS[platform].dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${dir}\\.(partial|old)-\\d+$`);
}

export function entryMode(platform, relName, zipMode) {
  if (!isLinux(platform)) return null;
  const perm = zipMode & 0o777;
  const base = relName.split("/").pop();
  if (base === "electron" || base === "chrome_crashpad_handler") return 0o755;

  return perm === 0 ? 0o644 : perm;
}

export const RELEASE_ARCHIVES = [
  { name: "ddnet-ai.zip", kind: "zip" },
  { name: "ddnet-ai-linux.tar.gz", kind: "tar.gz" },
];

export function releaseAssetNames() {
  return RELEASE_ARCHIVES.map((a) => a.name);
}

export function ghReleaseArgs({ tag, assets, repo, target, notes }) {
  return ["release", "create", tag, ...assets, "--repo", repo, "--target", target, "--title", `DDNet AI ${tag}`, "--notes", notes];
}

export function windowReadme(platform) {
  if (isLinux(platform)) {
    return `DDNet AI -- окно для бота
=========================

Эту папку (app-linux) кладут ВНУТРЬ папки бота, рядом со start.mjs. Запускать
не её, а "DDNet AI.sh" в папке бота (он сам найдёт ddnet-ai в этой папке).

Окно само найдёт бота, запустит его и покажет. Node.js ставить не обязательно:
если его нет или он старше 24-го, бот запускается встроенным в окно Node.

DDNet AI -- the bot's window
============================

This folder (app-linux) goes INSIDE the bot folder, next to start.mjs. Run
"DDNet AI.sh" in the bot folder, not the file in here (it finds ddnet-ai in this
folder).

The window finds the bot, starts it and shows it. Node.js does not have to be
installed: without it, or with one older than 24, the bot runs on the Node
built into the window.
`;
  }
  return null;
}
