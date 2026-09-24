import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { t } from "../i18n.ts";

export const SKIN_URLS = ["https://skins.ddnet.org/skin/", "https://skins.ddnet.org/skin/community/"];
export const SKIN_CACHE_DIR = join("runs", "skincache");
const MAX_SKIN_BYTES = 4 * 1024 * 1024;

export type Env = { [k: string]: string | undefined };

export function dataDirCandidates(env: Env, platform: string = process.platform): string[] {
  const home = env.USERPROFILE ?? env.HOME ?? "";
  const out: string[] = [];
  const add = (p: string | null): void => {
    if (p !== null && p !== "" && !out.includes(p)) out.push(p);
  };
  const pf = env.ProgramFiles ?? "C:\\Program Files";
  const pf86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  if (platform === "win32") {

    add(join(pf86, "Steam", "steamapps", "common", "DDraceNetwork", "ddnet", "data"));
    add(join(pf, "Steam", "steamapps", "common", "DDraceNetwork", "ddnet", "data"));
    for (const d of ["C", "D", "E", "F"]) add(`${d}:\\SteamLibrary\\steamapps\\common\\DDraceNetwork\\ddnet\\data`);
    add(join(pf, "DDNet", "data"));
    add(join(pf86, "DDNet", "data"));
    if (env.LOCALAPPDATA) add(join(env.LOCALAPPDATA, "DDNet", "data"));
    if (env.APPDATA) add(join(env.APPDATA, "DDNet", "data"));
  }
  if (home !== "") {
    add(join(home, "DDNet", "data"));
    add(join(home, ".local", "share", "Steam", "steamapps", "common", "DDraceNetwork", "ddnet", "data"));
    add(join(home, ".steam", "steam", "steamapps", "common", "DDraceNetwork", "ddnet", "data"));
    add(join(home, ".local", "share", "ddnet", "data"));
  }
  add("/usr/share/ddnet/data");
  add("/usr/local/share/ddnet/data");

  add(join("vendor", "DDNet-20.0-linux_x86_64", "data"));
  add(join("vendor", "DDNet-20.0", "data"));
  return out;
}

export const CLIENT_FOLDER = /^(ddnet|ddracenetwork|tclient|tater[ _-]?client|cactus|best[ _-]?client|chillerbot|entity[ _-]?client|aiodob|fclient|kaizo)/i;

export function scanForUnpacked(env: Env, list: (dir: string) => string[] = safeList, platform: string = process.platform): string[] {
  const home = env.USERPROFILE ?? env.HOME ?? "";
  const bases: string[] = [];
  if (home !== "") bases.push(home, join(home, "Desktop"), join(home, "OneDrive", "Desktop"), join(home, "Downloads"), join(home, "Games"), join(home, "Documents"));
  if (platform === "win32") {
    for (const b of [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Programs") : undefined, env.LOCALAPPDATA]) {
      if (b !== undefined && b !== "") bases.push(b);
    }
    for (const d of ["C", "D", "E", "F"]) bases.push(`${d}:\\`, `${d}:\\Games`);
  }
  const out: string[] = [];
  for (const base of bases) {
    for (const name of list(base)) {
      if (!CLIENT_FOLDER.test(name)) continue;
      out.push(join(base, name, "data"), join(base, name, "ddnet", "data"));
      for (const inner of list(join(base, name))) {
        if (CLIENT_FOLDER.test(inner)) out.push(join(base, name, inner, "data"));
      }
    }
  }
  return out;
}

const ASSET_KIND_FILES: [string, string][] = [
  ["game", "game.png"],
  ["emoticons", "emoticons.png"],
  ["particles", "particles.png"],
  ["hud", "hud.png"],
  ["extras", "extras.png"],
];

function cfgValue(cfg: string, key: string): string | null {
  const m = new RegExp(`^\\s*${key}\\s+(?:"((?:[^"\\\\]|\\\\.)*)"|(\\S+))`, "m").exec(cfg);
  if (m === null) return null;
  const v = (m[1] ?? m[2] ?? "").replace(/\\(.)/g, "$1").trim();
  return v === "" || v === "default" ? null : v;
}

export function chosenAssets(userDirs: string[], read: (file: string) => string | null = readText, exists: (p: string) => boolean = existsSync): Map<string, string> {
  const out = new Map<string, string>();
  for (const u of userDirs) {
    const cfg = read(join(u, "settings_ddnet.cfg"));
    if (cfg === null) continue;
    const found = (paths: string[]): string | null => paths.find((p) => exists(p)) ?? null;
    for (const [kind, file] of ASSET_KIND_FILES) {
      const name = cfgValue(cfg, `cl_asset_${kind}`);

      if (name === null || safeSkinName(name) === null) continue;
      const hit = found([join(u, "assets", kind, `${name}.png`), join(u, "assets", kind, name, `${kind}.png`)]);
      if (hit !== null) out.set(file, hit);
    }
    const ent = cfgValue(cfg, "cl_assets_entities");
    if (ent !== null && safeSkinName(ent) !== null) {
      const hit = found([join(u, "assets", "entities", ent, "ddnet.png"), join(u, "assets", "entities", `${ent}.png`)]);
      if (hit !== null) out.set("editor/entities_clear/ddnet.png", hit);
    }

    return out;
  }
  return out;
}

export const DATA_CACHE_DIR = join("runs", "ddnet-data");
export const DATA_URL = "https://raw.githubusercontent.com/ddnet/ddnet/20.0/data/";
const DATA_FILE_OK =
  /^(?:(?:game|emoticons|extras|hud|arrow|particles)\.png|editor\/(?:entities_clear\/ddnet|speed_arrow)\.png|fonts\/DejaVuSans\.ttf|mapres\/[A-Za-z0-9_][A-Za-z0-9_ .-]{0,63}\.png|audio\/[a-z0-9_-]{1,48}\.wv)$/;
const MAX_DATA_BYTES = 4 * 1024 * 1024;

export function downloadableData(rel: string): boolean {
  return DATA_FILE_OK.test(rel) && !rel.includes("..");
}

function looksRight(rel: string, buf: Uint8Array): boolean {
  if (rel.endsWith(".png")) return isPng(buf);
  if (rel.endsWith(".wv")) return buf.length > 32 && buf[0] === 0x77 && buf[1] === 0x76 && buf[2] === 0x70 && buf[3] === 0x6b;
  if (rel.endsWith(".ttf")) return buf.length > 4 && ((buf[0] === 0 && buf[1] === 1 && buf[2] === 0 && buf[3] === 0) || String.fromCharCode(...buf.subarray(0, 4)) === "true");
  return false;
}

const dataFailedAt = new Map<string, number>();
const dataInFlight = new Map<string, Promise<string | null>>();

export function downloadData(rel: string, cacheDir: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  if (!downloadableData(rel)) return Promise.resolve(null);
  const last = dataFailedAt.get(rel);
  if (last !== undefined && Date.now() - last < FAIL_MS) return Promise.resolve(null);
  const running = dataInFlight.get(rel);
  if (running) return running;
  const job = (async (): Promise<string | null> => {
    try {
      const res = await fetcher(DATA_URL + rel.split("/").map(encodeURIComponent).join("/"), { signal: AbortSignal.timeout(20_000) });
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.length <= MAX_DATA_BYTES && looksRight(rel, buf)) {
          const file = join(cacheDir, ...rel.split("/"));
          mkdirSync(join(file, ".."), { recursive: true });
          writeFileSync(file, buf);
          return file;
        }
      }
    } catch {

    }
    dataFailedAt.set(rel, Date.now());
    return null;
  })().finally(() => dataInFlight.delete(rel));
  dataInFlight.set(rel, job);
  return job;
}

export function wavFromPcm(channelData: Float32Array[], sampleRate: number): Buffer {
  const channels = Math.max(1, channelData.length);
  const frames = channelData[0]?.length ?? 0;
  const bytes = frames * channels * 2;
  const out = Buffer.alloc(44 + bytes);
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(36 + bytes, 4);
  out.write("WAVE", 8, "ascii");
  out.write("fmt ", 12, "ascii");
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * channels * 2, 28);
  out.writeUInt16LE(channels * 2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36, "ascii");
  out.writeUInt32LE(bytes, 40);
  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, channelData[c]?.[i] ?? 0));
      out.writeInt16LE(Math.round(v < 0 ? v * 32768 : v * 32767), at);
      at += 2;
    }
  }
  return out;
}

export function steamLibraryData(env: Env, platform: string = process.platform, read: (file: string) => string | null = readText): string[] {
  const home = env.USERPROFILE ?? env.HOME ?? "";
  const roots: string[] = [];
  if (platform === "win32") {
    roots.push(join(env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Steam"), join(env.ProgramFiles ?? "C:\\Program Files", "Steam"));
  } else if (home !== "") {
    roots.push(join(home, ".local", "share", "Steam"), join(home, ".steam", "steam"), join(home, "Library", "Application Support", "Steam"));
  }
  const out: string[] = [];
  for (const root of roots) {
    for (const vdf of [join(root, "steamapps", "libraryfolders.vdf"), join(root, "config", "libraryfolders.vdf")]) {
      const text = read(vdf);
      if (text === null) continue;
      for (const lib of vdfPaths(text)) {
        const d = join(lib, "steamapps", "common", "DDraceNetwork", "ddnet", "data");
        if (!out.includes(d)) out.push(d);
      }
    }
  }
  return out;
}

export function vdfPaths(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/"path"\s+"((?:[^"\\]|\\.)*)"/gi)) out.push(m[1].replace(/\\(.)/g, "$1"));
  return out;
}

function readText(file: string): string | null {
  try {
    return statSync(file).size > 1024 * 1024 ? null : readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export function typedDataDir(typed: string, exists: (p: string) => boolean = existsSync): { dir: string | null; note: string } {
  let dir = typed.trim();
  if (dir.length >= 2 && ((dir.startsWith('"') && dir.endsWith('"')) || (dir.startsWith("'") && dir.endsWith("'")))) dir = dir.slice(1, -1).trim();
  if (dir === "") return { dir: null, note: "" };
  for (const c of [dir, join(dir, "data"), join(dir, "ddnet", "data")]) {
    if (exists(join(c, "game.png"))) return { dir: c, note: c === dir ? "" : t("беру {dir}", { dir: c }) };
  }

  if ([dir, join(dir, "..")].some((c) => exists(join(c, "settings_ddnet.cfg")))) {
    return { dir: null, note: t("«{dir}» -- папка настроек DDNet, а не установка: выбранные в игре наборы беру оттуда, остальное нахожу или скачиваю сам", { dir }) };
  }
  return { dir: null, note: t("в «{dir}» нет game.png, это не папка data DDNet", { dir }) };
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export function looksLikeData(dir: string, exists: (p: string) => boolean = existsSync): boolean {
  return exists(join(dir, "game.png")) || exists(join(dir, "audio"));
}

export function pickDataDir(cands: string[], exists: (p: string) => boolean = existsSync): string | null {
  return cands.find((c) => looksLikeData(c, exists)) ?? null;
}

export function userDirCandidates(env: Env): string[] {
  const home = env.USERPROFILE ?? env.HOME ?? "";
  const out: string[] = [];
  if (env.APPDATA) out.push(join(env.APPDATA, "DDNet"), join(env.APPDATA, "Teeworlds"));
  if (home !== "") {
    out.push(join(home, "AppData", "Roaming", "DDNet"));
    out.push(join(home, ".local", "share", "ddnet"));
    out.push(join(home, "Library", "Application Support", "DDNet"));
    out.push(join(home, ".teeworlds"));
  }
  return [...new Set(out)];
}

const RESERVED = ["CON", "PRN", "AUX", "NUL", ..."0123456789\u00b9\u00b2\u00b3".split("").flatMap((d) => ["COM" + d, "LPT" + d])];

function oddSpace(code: number): boolean {

  return (
    code < 0x20 ||
    code === 0x85 ||
    code === 0xa0 ||
    code === 0x34f ||
    code === 0x115f ||
    code === 0x1160 ||
    code === 0x1680 ||
    code === 0x180e ||
    (code >= 0x2000 && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202f) ||
    (code >= 0x205f && code <= 0x2064) ||
    (code >= 0x206a && code <= 0x206f) ||
    code === 0x2800 ||
    code === 0x3000 ||
    code === 0x3164 ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    code === 0xfeff ||
    code === 0xffa0 ||
    (code >= 0xfff9 && code <= 0xfffc)
  );
}

export function safeSkinName(name: string): string | null {
  if (name === "" || Buffer.byteLength(name, "utf8") >= 24) return null;
  let prevSpace = false;
  let prevPeriod = false;
  let first = true;
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f || '\\/|:*?<>"'.includes(ch)) return null;
    if (code !== 0x20 && oddSpace(code)) return null;
    if (code === 0x20) {
      if (first || prevSpace) return null;
      prevSpace = true;
      prevPeriod = false;
    } else {
      prevSpace = false;
      prevPeriod = ch === ".";
      first = false;
    }
  }
  if (prevSpace || prevPeriod) return null;
  const upper = name.toUpperCase();
  if (RESERVED.some((r) => upper === r || upper.startsWith(r + "."))) return null;
  return name;
}

export function skinFiles(name: string, dataDir: string | null, userDirs: string[], cacheDir: string): string[] {
  const files: string[] = [];
  if (dataDir !== null) files.push(join(dataDir, "skins", `${name}.png`));
  for (const u of userDirs) {
    files.push(join(u, "skins", `${name}.png`));
    files.push(join(u, "downloadedskins", `${name}.png`));
  }
  files.push(join(cacheDir, `${name}.png`));
  return files;
}

export function isPng(buf: Uint8Array): boolean {
  return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

const failedAt = new Map<string, number>();
const inFlight = new Map<string, Promise<string | null>>();

const FAIL_MS = 10 * 60_000;

export function downloadSkin(name: string, cacheDir: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  const safe = safeSkinName(name);
  if (safe === null) return Promise.resolve(null);

  if (failedAt.size > 256) {
    const now = Date.now();
    for (const [k, at] of failedAt) if (now - at >= FAIL_MS) failedAt.delete(k);
    while (failedAt.size > 2048) failedAt.delete(failedAt.keys().next().value as string);
  }
  const last = failedAt.get(safe);
  if (last !== undefined && Date.now() - last < FAIL_MS) return Promise.resolve(null);
  const running = inFlight.get(safe);
  if (running) return running;
  const job = (async (): Promise<string | null> => {
    for (const base of SKIN_URLS) {
      try {
        const res = await fetcher(base + encodeURIComponent(safe) + ".png", { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) continue;
        const buf = new Uint8Array(await res.arrayBuffer());
        if (!isPng(buf) || buf.length > MAX_SKIN_BYTES) continue;
        mkdirSync(cacheDir, { recursive: true });
        const file = join(cacheDir, `${basename(safe)}.png`);
        writeFileSync(file, buf);
        return file;
      } catch {

      }
    }
    failedAt.set(safe, Date.now());
    return null;
  })().finally(() => inFlight.delete(safe));
  inFlight.set(safe, job);
  return job;
}

export function firstExisting(files: string[]): string | null {
  for (const f of files) {
    try {
      if (statSync(f).isFile()) return f;
    } catch {

    }
  }
  return null;
}

export function findDownloadedMap(
  name: string,
  userDirs: string[],
  list: (dir: string) => string[] = safeList,
  hashes: { crc?: number; sha256?: string } = {},
): string | null {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${esc}_([0-9a-f]{8}|[0-9a-f]{64})\\.map$`, "i");
  const want: string[] = [];
  if (typeof hashes.sha256 === "string" && /^[0-9a-f]{64}$/i.test(hashes.sha256)) want.push(hashes.sha256.toLowerCase());
  if (typeof hashes.crc === "number" && Number.isFinite(hashes.crc)) want.push((hashes.crc >>> 0).toString(16).padStart(8, "0"));
  const found: string[] = [];
  for (const u of userDirs) {
    const dir = join(u, "downloadedmaps");
    for (const f of list(dir)) {
      const m = re.exec(f);
      if (m === null) continue;
      if (want.length > 0) {
        if (want.includes(m[1].toLowerCase())) return join(dir, f);
      } else {
        found.push(join(dir, f));
      }
    }
  }
  return found.length === 1 ? found[0] : null;
}

export const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

export function readIfSmall(file: string, max = 64 * 1024 * 1024): Buffer | null {
  try {
    if (statSync(file).size > max) return null;
    return readFileSync(file);
  } catch {
    return null;
  }
}
