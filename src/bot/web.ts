import * as http from "node:http";
import { createReadStream, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { writeJsonAtomic } from "./atomicWrite.ts";
import { extname, join, resolve, sep } from "node:path";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { CONTENT_TYPES, DATA_CACHE_DIR, SKIN_CACHE_DIR, chosenAssets, dataDirCandidates, downloadData, downloadSkin, downloadableData, findDownloadedMap, firstExisting, pickDataDir, readIfSmall, safeSkinName, scanForUnpacked, skinFiles, steamLibraryData, typedDataDir, userDirCandidates, wavFromPcm } from "./webAssets.ts";
import decodeWavpack from "./wavpack/decode-wavpack.js";
import { SCENE_CACHE_DIR, parseSceneAsync } from "./webMap.ts";
import type { ParsedScene } from "./webMap.ts";
import { pageScript } from "./webPage.ts";
import { isAuto } from "./serverPick.ts";
import { canonIp } from "./ipv6.ts";
import { testProxy } from "./socksUdp.ts";
import type { ProxyTest } from "./socksUdp.ts";
import { CmdLimiter, LAN_COOKIE, LanGate, langOfHeader, lanHostOk, loginPage, parseCookies, privateAddresses, sessionCookie, validLanCode } from "./lan.ts";
import { qrSvg } from "./qr.ts";
import { EN, getLang, makeT, t } from "../i18n.ts";
import type { Lang } from "../i18n.ts";

const LAUNCH_FILE = "settings.json";

const ASSET_KINDS = new Set([".wav", ".ogg", ".mp3", ".png", ".ttf", ".otf"]);

function assetRoot(): string | null {
  const set = readLaunch().ddnetData;
  if (typeof set === "string" && set.trim() !== "") {
    const typed = typedDataDir(set);
    if (typed.dir !== null) return typed.dir;
  }
  return defaultAssetRoot();
}

let cachedRoot: string | null | undefined;

function defaultAssetRoot(): string | null {
  if (cachedRoot !== undefined) return cachedRoot;
  const cands = [...dataDirCandidates(process.env)];
  cands.splice(cands.length - 2, 0, ...steamLibraryData(process.env), ...scanForUnpacked(process.env));
  cachedRoot = pickDataDir(cands);
  return cachedRoot;
}

function readLaunchStrict(): Record<string, string> | null {
  try {

    const raw = JSON.parse(readFileSync(LAUNCH_FILE, "utf8").replace(/^\uFEFF/, "")) as Record<string, string>;
    return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : null;
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === "ENOENT" ? {} : null;
  }
}

function readLaunch(): Record<string, string> {
  return readLaunchStrict() ?? {};
}

function skinNames(): string[] {
  const dirs: string[] = [];
  const data = assetRoot();
  if (data !== null) dirs.push(join(data, "skins"));
  for (const u of userDirCandidates(process.env)) dirs.push(join(u, "skins"), join(u, "downloadedskins"));
  dirs.push(SKIN_CACHE_DIR);
  const seen = new Set<string>();
  for (const dir of dirs) {
    try {
      for (const f of readdirSync(dir)) if (f.toLowerCase().endsWith(".png") && safeSkinName(f.slice(0, -4)) !== null) seen.add(f.slice(0, -4));
    } catch {

    }
  }
  return [...seen].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).slice(0, 4000);
}

function launchServerKey(server: unknown): string | null {
  if (typeof server !== "string" || isAuto(server)) return null;
  const s = server.trim();
  const v6 = /^\[([^\]]*)\](?::(\d{1,5}))?$/.exec(s);
  if (v6 !== null) return `[${canonIp(v6[1].trim()).toLowerCase()}]:${v6[2] === undefined ? 8303 : Number(v6[2])}`;
  const at = s.lastIndexOf(":");
  if (at <= 0) return `${s.toLowerCase()}:8303`;

  if (!/^\d{1,5}$/.test(s.slice(at + 1))) return null;
  return `${s.slice(0, at).toLowerCase()}:${Number(s.slice(at + 1))}`;
}

let cpuSample: { at: number; used: number; pct: number } | null = null;
function processCpu(): number {
  const now = Date.now();
  const u = process.cpuUsage();
  const used = (u.user + u.system) / 1000;
  if (cpuSample === null) {
    cpuSample = { at: now, used, pct: 0 };
    return 0;
  }
  if (now - cpuSample.at < 1000) return cpuSample.pct;
  const cores = Math.max(1, cpus().length);
  const pct = Math.max(0, Math.min(100, Math.round(((used - cpuSample.used) / (now - cpuSample.at) / cores) * 100)));
  cpuSample = { at: now, used, pct };
  return pct;
}

function sameLaunchServer(a: unknown, b: unknown): boolean {
  const x = launchServerKey(a);
  return x !== null && x === launchServerKey(b);
}

const downloadsOn = (): boolean => readLaunch().skinDownload !== "off";

let chosen: { at: number; map: Map<string, string> } | null = null;
function chosenNow(): Map<string, string> {
  if (chosen === null || Date.now() - chosen.at > 5000) chosen = { at: Date.now(), map: chosenAssets(userDirCandidates(process.env)) };
  return chosen.map;
}

async function findAsset(rel: string, mayDownload = true): Promise<string | null> {
  const picked = chosenNow().get(rel);
  if (picked !== undefined && isFile(picked)) return picked;
  for (const root of [assetRoot(), DATA_CACHE_DIR]) {
    if (root === null) continue;
    const full = resolve(root, rel);
    if (full.startsWith(resolve(root) + sep) && isFile(full)) return full;
  }
  if (mayDownload && downloadsOn() && downloadableData(rel)) return downloadData(rel, DATA_CACHE_DIR);
  return null;
}

const CORE_DATA = ["game.png", "emoticons.png", "extras.png", "hud.png", "arrow.png", "particles.png", "editor/entities_clear/ddnet.png", "editor/speed_arrow.png", "fonts/DejaVuSans.ttf"];
let fetching: Promise<void> | null = null;

let proxyTesting: Promise<ProxyTest> | null = null;
function haveGraphics(): boolean {
  if (chosenNow().has("game.png")) return true;
  const root = assetRoot();
  return (root !== null && isFile(join(root, "game.png"))) || isFile(join(DATA_CACHE_DIR, "game.png"));
}
function fetchMissingData(): void {
  if (fetching !== null || !downloadsOn() || haveGraphics()) return;
  fetching = (async () => {
    for (const rel of CORE_DATA) await findAsset(rel);
  })().finally(() => {
    if (haveGraphics()) return;
    setTimeout(() => {
      fetching = null;
    }, 10 * 60_000).unref?.();
  });
}

const wavs = new Map<string, Promise<Buffer | null>>();
export function wavOf(file: string, decode: typeof decodeWavpack = decodeWavpack): Promise<Buffer | null> {
  let job = wavs.get(file);
  if (job === undefined) {
    job = (async () => {
      try {
        const { channelData, sampleRate } = await decode(readFileSync(file));
        return channelData.length > 0 && sampleRate > 0 ? wavFromPcm(channelData, sampleRate) : null;
      } catch {
        return null;
      }
    })();
    wavs.set(file, job);

    void job.then((wav) => {
      if (wav === null && wavs.get(file) === job) wavs.delete(file);
    });
  }
  return job;
}
import type { BotLine, BotStatus, CommandListItem, DuelRow, LiveFrame, LiveMap } from "./bot.ts";

export type WebBot = {
  status: () => BotStatus;
  statsLine: () => string;

  handleConsole: (line: string) => string | Promise<string>;

  liveMap: () => LiveMap | null;
  liveFrame: () => LiveFrame | null;

  clipList?: () => { name: string; size: number; when: number }[];
  duelList?: () => DuelRow[];
  clipPath?: (name: string) => string | null;
  configInfo?: () => unknown;
  commandNames?: () => string[];
  commandList?: () => CommandListItem[];

  voteOptions?: () => string[];

  relationsInfo?: () => Record<string, string[]>;
  setRelation?: (list: "war" | "friend" | "ignore", name: string, on: boolean) => string;

  llmInfo?: () => unknown;
  setLlm?: (raw: unknown) => string;
  autoChatInfo?: () => unknown;
  setAutoChat?: (raw: unknown) => unknown;
  checkUpdate?: () => Promise<string>;
  knobs?: () => { key: string; value: unknown; def: unknown; changed: boolean }[];
  setKnob?: (key: string, value: unknown) => string;
  resetKnobs?: () => string;

  mapData?: () => { name: string; bytes: Uint8Array } | null;

  emoticons?: () => { id: number; e: number; age: number }[];
};

type ClientLike = {
  map?: { mapBuffer?: Uint8Array; map_name?: string; downloading?: boolean; crc?: number; map_details?: { map_sha256?: Uint8Array } };
  on?: (event: string, fn: (m: { client_id: number; emoticon: number }) => void) => unknown;

  SnapshotUnpacker?: { on?: (event: string, fn: (e: { sound_id?: number; common?: { x?: number; y?: number } }) => void) => unknown };
};
function clientOf(bot: WebBot): ClientLike | null {
  const c = (bot as { client?: unknown }).client;
  return typeof c === "object" && c !== null ? (c as ClientLike) : null;
}

const MAX_LINES = 200;

const FRAME_ANCESTORS = "frame-ancestors 'self' app://shell";

const FRAME_ANCESTORS_LAN = "frame-ancestors 'none'";

export type LanInfo = { on: boolean; listening: boolean; port: number; urls: string[]; code: string };

export type WebUi = { port: number; push: (line: BotLine) => void; close: () => void; lanInfo: () => LanInfo; setLan: (on: boolean) => Promise<LanInfo> };

export type WebOptions = {
  lan?: boolean;
  lanHosts?: string[];
  lanStore?: { read: () => { code?: string }; write: (patch: Record<string, unknown>) => void };

  cmdLimiter?: CmdLimiter;
};

const settingsStore = {
  read: (): { code?: string } => {
    const raw = readLaunch() as Record<string, unknown>;
    return { code: typeof raw.lanCode === "string" ? raw.lanCode : undefined };
  },

  write: (patch: Record<string, unknown>): void => {
    let cur: Record<string, unknown> = {};
    let text: string | null = null;
    try {
      text = readFileSync(LAUNCH_FILE, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
        console.error("[web] lan: settings.json is unreadable, the change is not saved:", err);
        return;
      }
    }
    if (text !== null) {
      try {
        const v = JSON.parse(text.replace(/^\uFEFF/, "")) as unknown;
        if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
        cur = v as Record<string, unknown>;
      } catch {
        console.error("[web] lan: settings.json is damaged, the change is not saved");
        return;
      }
    }
    writeJsonAtomic(LAUNCH_FILE, JSON.stringify({ ...cur, ...patch }, null, 2));
  },
};

export type ViewOpts = { corner: string; scale: number; show: string[]; nicks: "on" | "off" | "id" };
export function viewOpts(search: string, def: { corner: string; show: string[]; nicks: "on" | "off" | "id" }): ViewOpts {
  const q = new URLSearchParams(search);
  const corner = q.get("corner");
  const sc = Number.parseFloat(q.get("scale") ?? "");
  const known = ["chat", "score", "board", "sub"];
  const asked = (q.get("show") ?? "").toLowerCase().split(/[,+ ]/).filter((x) => known.indexOf(x) >= 0);
  const n = q.get("nicks");
  return {
    corner: corner !== null && ["tl", "tc", "tr", "bl", "bc", "br", "c"].indexOf(corner.toLowerCase()) >= 0 ? corner.toLowerCase() : def.corner,
    scale: Number.isFinite(sc) ? Math.min(3, Math.max(0.5, sc)) : 1,
    show: asked.length > 0 ? asked : def.show,
    nicks: n === "on" || n === "off" || n === "id" ? n : def.nicks,
  };
}

// Its #src line is an attribution notice required by NOTICE (GPLv3 section 7(b) additional terms): keep it in modified versions.
const OVERLAY_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>DDNet AI duel</title><style>
html,body{margin:0;background:transparent;color:#fff;font:800 56px/1.15 system-ui,"Segoe UI",sans-serif;text-shadow:0 2px 8px #000,0 0 3px #000}
#box{position:fixed;top:0;left:0;display:inline-flex;flex-direction:column;gap:4px;padding:14px 22px;border-radius:14px}
#box.tc{left:50%;transform:translateX(-50%)}
#box.tr{left:auto;right:0}
#box.bl{top:auto;bottom:0}
#box.bc{top:auto;bottom:0;left:50%;transform:translateX(-50%)}
#box.br{top:auto;left:auto;bottom:0;right:0}
#box.c{top:50%;left:50%;transform:translate(-50%,-50%)}
#box.bg{background:rgba(10,14,20,.72)}
#box[hidden]{display:none}
#row{display:flex;gap:.45em;align-items:baseline;white-space:nowrap;font-size:calc(56px*var(--sc,1))}
.n{font-size:.62em;font-weight:700;max-width:9em;overflow:hidden;text-overflow:ellipsis}
#sc{font-variant-numeric:tabular-nums}
#sub{font:600 calc(22px*var(--sc,1))/1.2 system-ui,sans-serif;opacity:.85}
#src{font:600 13px/1.2 system-ui,sans-serif;opacity:.6}
#box.idle{opacity:.7}
#box.noscore #row,#box.nosub #sub,#box.nonick .n{display:none}
</style></head><body><div id="box"><div id="row"><span class="n" id="me"></span><span id="sc"></span><span class="n" id="op"></span></div><div id="sub"></div><div id="src">DDNet AI · t.me/aiddnet</div></div>
<script>
const $=(id)=>document.getElementById(id);
${viewOpts.toString()}
const O=viewOpts(location.search,{corner:"tl",show:["score","sub"],nicks:"on"});
$("box").classList.add(O.corner);
document.body.style.setProperty("--sc",String(O.scale));
if(O.show.indexOf("score")<0)$("box").classList.add("noscore");
if(O.show.indexOf("sub")<0)$("box").classList.add("nosub");
if(O.nicks!=="on")$("box").classList.add("nonick");
if(new URLSearchParams(location.search).get("bg")==="1")$("box").classList.add("bg");
async function pull(){
 let d=null;try{d=await(await fetch("/api/duelnow",{cache:"no-store"})).json()}catch{d=null}
 const box=$("box");
 if(!d){box.hidden=true;return}
 const cur=d.now,last=d.last,show=cur||last;
 box.hidden=!show;if(!show)return;
 box.classList.toggle("idle",!cur);
 $("me").textContent=cur?d.me:(last.by||d.me);
 $("op").textContent=cur?cur.name:last.opponent;
 $("sc").textContent=(cur?cur.ours:last.ours)+" : "+(cur?cur.theirs:last.theirs);
 $("sub").textContent=cur?"duel":"last duel";
}
pull();setInterval(pull,500);
</script></body></html>`;

const DUEL_ROWS = 50;

const APP_COLOR = "#12161c";
const APP_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${APP_COLOR}"/><g fill="none" stroke="#3b82f6" stroke-width="41"><circle cx="256" cy="256" r="107.5"/><circle cx="256" cy="256" r="184.3"/></g><circle cx="256" cy="256" r="51" fill="#fff"/></svg>`;
const APP_MANIFEST = JSON.stringify({
  name: "DDNet AI",
  short_name: "DDNet AI",
  start_url: "/",
  scope: "/",
  display: "standalone",
  display_override: ["fullscreen", "standalone"],
  background_color: APP_COLOR,
  theme_color: APP_COLOR,
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
  ],
});

const ICON_PAL = [[255, 255, 255], [59, 130, 246], [18, 22, 28]];
const appIcons = new Map<number, Buffer>();
export function appIconPng(size: number): Buffer {
  const have = appIcons.get(size);
  if (have !== undefined) return have;

  const at = (x: number, y: number): number => {
    const dx = x / size - 0.5;
    const dy = y / size - 0.5;
    const d2 = dx * dx + dy * dy;
    if (d2 < 0.01) return 0;
    if ((d2 >= 0.0289 && d2 < 0.0625) || (d2 >= 0.1024 && d2 < 0.16)) return 1;
    return 2;
  };

  const row = size * 3 + 1;
  const raw = Buffer.alloc(row * size);
  const cnt = [0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      cnt[0] = cnt[1] = cnt[2] = 0;
      cnt[at(x + 0.25, y + 0.25)]++;
      cnt[at(x + 0.75, y + 0.25)]++;
      cnt[at(x + 0.25, y + 0.75)]++;
      cnt[at(x + 0.75, y + 0.75)]++;
      for (let k = 0; k < 3; k++) raw[y * row + 1 + x * 3 + k] = Math.round((cnt[0] * ICON_PAL[0][k] + cnt[1] * ICON_PAL[1][k] + cnt[2] * ICON_PAL[2][k]) / 4);
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "latin1");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0);
  head.writeUInt32BE(size, 4);
  head[8] = 8;
  head[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  appIcons.set(size, png);
  return png;
}

export const HISTORY_BUCKET_MS = 600_000;

const HISTORY_BUCKETS = 144;
export class StatsHistory {
  private rows: { at: number; blocks: number; blockedBy: number }[] = [];
  private seen = { blocks: 0, blockedBy: 0 };
  private readonly now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  add(blocks: number, blockedBy: number): void {
    const at = Math.floor(this.now() / HISTORY_BUCKET_MS) * HISTORY_BUCKET_MS;
    const dBlocks = blocks >= this.seen.blocks ? blocks - this.seen.blocks : blocks;
    const dBy = blockedBy >= this.seen.blockedBy ? blockedBy - this.seen.blockedBy : blockedBy;
    this.seen = { blocks, blockedBy };
    let row = this.rows[this.rows.length - 1];
    if (row === undefined || row.at !== at) {
      row = { at, blocks: 0, blockedBy: 0 };
      this.rows.push(row);
      if (this.rows.length > HISTORY_BUCKETS) this.rows.shift();
    }
    row.blocks += dBlocks;
    row.blockedBy += dBy;
  }

  totals(): { blocks: number; blockedBy: number } {
    return { ...this.seen };
  }
  list(): { at: number; blocks: number; blockedBy: number }[] {
    return this.rows.map((r) => ({ ...r }));
  }
}

export function startWebUi(bot: WebBot, port: number, version: string, opts: WebOptions = {}): Promise<WebUi> {

  const lines: (BotLine & { seq: number })[] = [];

  const boot = `${process.pid}-${Date.now().toString(36)}`;
  let seq = 0;

  const history = new StatsHistory();
  const sampleHistory = (): void => {
    try {
      const line = bot.statsLine();
      const a = /\bblocks=(\d+)/.exec(line);
      const b = /\bblockedBy=(\d+)/.exec(line);
      if (a !== null && b !== null) history.add(Number(a[1]), Number(b[1]));
    } catch {

    }
  };
  sampleHistory();
  const sampler = setInterval(sampleHistory, 15_000);
  sampler.unref?.();

  const emotes = new Map<number, { e: number; at: number }>();
  let heard: ClientLike | null = null;

  const heardSounds: { s: number; id: number; x: number; y: number; at: number }[] = [];
  let soundSeq = 0;
  const soundList = (): { s: number; id: number; x: number; y: number }[] => {
    const now = Date.now();
    return heardSounds.filter((h) => now - h.at < 1000).map(({ s, id, x, y }) => ({ s, id, x, y }));
  };

  let heardSnap: unknown = null;
  const listen = setInterval(() => {
    const c = clientOf(bot);
    if (c === null || typeof c.on !== "function") return;
    if (c !== heard) {
      heard = c;
      try {
        c.on("emote", (m) => {
          if (typeof m?.client_id === "number" && m.client_id >= 0) emotes.set(m.client_id, { e: m.emoticon, at: Date.now() });
        });
      } catch {

      }
    }

    const snap = c.SnapshotUnpacker;
    if (snap === undefined || snap === null || snap === heardSnap || typeof snap.on !== "function") return;
    heardSnap = snap;
    try {
      snap.on("sound_world", (e) => {
        const id = e?.sound_id;
        if (typeof id !== "number" || id < 0 || id > 64) return;
        heardSounds.push({ s: ++soundSeq, id, x: Math.round(e.common?.x ?? 0), y: Math.round(e.common?.y ?? 0), at: Date.now() });
        if (heardSounds.length > 64) heardSounds.splice(0, heardSounds.length - 64);
      });
    } catch {

    }
  }, 250);
  listen.unref?.();
  const emoticonList = (): { id: number; e: number; age: number }[] => {
    if (bot.emoticons) return bot.emoticons();
    const now = Date.now();
    const out: { id: number; e: number; age: number }[] = [];
    for (const [id, v] of emotes) {
      if (now - v.at > 2500) emotes.delete(id);
      else out.push({ id, e: v.e, age: now - v.at });
    }
    return out;
  };

  let scene: { name: string; parsed: ParsedScene | null; at: number; job: Promise<ParsedScene | null> | null } | null = null;
  const mapBytes = (): { name: string; bytes: Uint8Array } | null => {
    const given = bot.mapData?.();
    if (given) return given;
    const c = clientOf(bot);
    const name = c?.map?.map_name ?? bot.liveFrame()?.map ?? "";
    if (c?.map?.mapBuffer && c.map.mapBuffer.length > 0 && !c.map.downloading) return { name, bytes: c.map.mapBuffer };
    if (name === "" || name === "?") return null;
    const safe = name.replace(/[\\/]/g, "_");
    const sha = c?.map?.map_details?.map_sha256;
    const hashes = {
      crc: typeof c?.map?.crc === "number" ? c.map.crc : undefined,
      sha256: sha instanceof Uint8Array && sha.length === 32 && sha.some((b) => b !== 0) ? Buffer.from(sha).toString("hex") : undefined,
    };
    const file = firstExisting([join("maps", `${safe}.map`)]) ?? findDownloadedMap(safe, userDirCandidates(process.env), undefined, hashes);
    const bytes = file === null ? null : readIfSmall(file);
    return bytes === null ? null : { name, bytes };
  };
  const sceneName = (): string => clientOf(bot)?.map?.map_name ?? bot.mapData?.()?.name ?? bot.liveFrame()?.map ?? "";

  const sceneKey = (): string => {
    const name = sceneName();
    const crc = clientOf(bot)?.map?.crc;
    if (typeof crc === "number") return `${name}#${(crc >>> 0).toString(16)}`;
    const given = bot.mapData?.();
    return given ? `${name}#${(crc32(given.bytes) >>> 0).toString(16)}` : name;
  };
  const currentScene = (): Promise<ParsedScene | null> => {
    const want = sceneKey();
    if (scene !== null && scene.name === want) {
      if (scene.job !== null) return scene.job;
      if (scene.parsed !== null || Date.now() - scene.at < 5000) return Promise.resolve(scene.parsed);
    }
    const entry: { name: string; parsed: ParsedScene | null; at: number; job: Promise<ParsedScene | null> | null } = { name: want, parsed: null, at: Date.now(), job: null };
    scene = entry;
    const src = mapBytes();
    if (src === null) return Promise.resolve(null);
    entry.job = parseSceneAsync(src.bytes, src.name, 4, SCENE_CACHE_DIR)
      .catch(() => null)
      .then((parsed) => {
        entry.parsed = parsed;
        entry.at = Date.now();
        entry.job = null;
        return parsed;
      });
    return entry.job;
  };

  const sceneFor = (url: URL): Promise<ParsedScene | "other" | null> => {
    const m = url.searchParams.get("m");
    return currentScene().then((sc) => (sc !== null && m !== null && m !== sc.scene.name ? "other" : sc));
  };
  const push = (line: BotLine): void => {
    lines.push({ ...line, seq: ++seq });
    if (lines.length > MAX_LINES) lines.shift();
  };

  const portNow = (): number => {
    const addr = server.address();
    return typeof addr === "object" && addr !== null ? addr.port : port;
  };
  const ownHost = (h: string | undefined): boolean => {
    const p = portNow();
    return h === `127.0.0.1:${p}` || h === `localhost:${p}`;
  };
  const allowed = (req: http.IncomingMessage, lan: boolean): boolean => {
    const hostOk = lan ? lanHostOk(req.headers.host, req.socket.localAddress, portNow()) : ownHost(req.headers.host);
    if (!hostOk) return false;
    if (req.method === "GET" || req.method === "HEAD") return true;
    if (req.headers["sec-fetch-site"] === "cross-site") return false;
    const origin = req.headers.origin;
    if (origin === undefined) return true;
    try {
      const o = new URL(origin);

      return o.protocol === "http:" && (lan ? o.host === req.headers.host : ownHost(o.host));
    } catch {
      return false;
    }
  };

  const store = opts.lanStore ?? settingsStore;

  const cmdLimit = opts.cmdLimiter ?? new CmdLimiter();
  let gate: LanGate | null = null;
  let lanServers: http.Server[] = [];
  let lanAddrs: string[] = [];
  let lanAsked = false;
  const lanInfo = (): LanInfo => ({
    on: lanAsked,
    listening: lanServers.length > 0,
    port: portNow(),
    urls: lanAddrs.map((a) => `http://${a}:${portNow()}/`),
    code: lanAsked && gate !== null ? gate.code : "",
  });

  const refuse = (res: http.ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8", extra: http.OutgoingHttpHeaders = {}): void => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store", connection: "close", ...extra });
    res.end(body);
  };

  const handleLan = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    res.setHeader("x-frame-options", "DENY");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    const g = gate;
    if (g === null || lanServers.length === 0 || !allowed(req, true)) {
      refuse(res, 403, t("чужой запрос"));
      return;
    }
    const lang = langOfHeader(req.headers["accept-language"]);
    const page = (state: "ask" | "wrong" | "locked", retryAfter = 0): string => loginPage(lang, state, retryAfter);
    let path = "";
    try {
      path = new URL(req.url ?? "/", "http://localhost").pathname;
    } catch {
      refuse(res, 400, t("плохое имя"));
      return;
    }
    if (req.method === "POST" && path === "/lan/login") {
      void readBody(req, 256).then((raw) => {
        if (raw === null) {
          tooBig(req, res, t("чужой запрос"));
          return;
        }
        const ip = req.socket.remoteAddress ?? "?";
        const r = g.tryLogin(ip, new URLSearchParams(raw).get("code") ?? "");
        if (r.ok) {
          push({ kind: "event", text: t("телефон вошёл по коду: {ip}", { ip }) });
          refuse(res, 303, "", "text/plain; charset=utf-8", { location: "/", "set-cookie": sessionCookie(r.token) });
          return;
        }
        if (r.rotated) push({ kind: "event", text: t("код для телефона заменён: слишком много неверных попыток") });
        if (r.globalLock) push({ kind: "event", text: t("вход с телефона закрыт на 10 минут: много неверных кодов с {ip}", { ip }) });
        if (r.locked || r.retryAfter > 0) refuse(res, 429, page("locked", r.retryAfter), "text/html; charset=utf-8", { "retry-after": String(r.retryAfter) });
        else refuse(res, 401, page("wrong"), "text/html; charset=utf-8");
      });
      return;
    }
    if (!g.hasSession(req.headers.cookie)) {
      refuse(res, 401, page("ask"), "text/html; charset=utf-8");
      return;
    }
    handle(req, res, true);
  };

  const handle = (req: http.IncomingMessage, res: http.ServerResponse, lan: boolean): void => {
    if (!allowed(req, lan)) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      res.end(t("чужой запрос"));
      return;
    }

    try {
      route(req, res, lan);
    } catch (err) {
      console.error("[web] route:", err);
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(t("внутренняя ошибка, подробности в логе бота"));
    }
  };

  const server = http.createServer((req, res) => handle(req, res, false));

  const setLan = async (on: boolean): Promise<LanInfo> => {
    if (!on) {
      lanAsked = false;
      const old = lanServers;
      lanServers = [];
      lanAddrs = [];
      gate?.revokeAll();
      for (const s of old) {
        s.close();
        s.closeAllConnections();
      }
      return lanInfo();
    }
    lanAsked = true;
    if (lanServers.length > 0) return lanInfo();
    const hosts = opts.lanHosts ?? privateAddresses();
    if (gate === null) {
      const stored = store.read().code;
      gate = new LanGate({ code: validLanCode(stored) ? stored : undefined, onCode: (c) => store.write({ lanCode: c }) });
    }
    const up: http.Server[] = [];
    const addrs: string[] = [];
    for (const h of hosts) {
      const s = http.createServer(handleLan);
      const ok = await new Promise<boolean>((resolve) => {
        s.once("error", (err) => {
          console.error(`[web] lan ${h}:`, err.message);
          resolve(false);
        });
        s.listen(portNow(), h, () => resolve(true));
      });
      if (ok) {

        s.on("error", (err) => console.error(`[web] lan ${h}:`, err.message));
        up.push(s);
        addrs.push(h);
      }
    }
    lanServers = up;
    lanAddrs = addrs;
    return lanInfo();
  };

  const route = (req: http.IncomingMessage, res: http.ServerResponse, lan: boolean): void => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/api") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ status: bot.status(), stats: bot.statsLine(), version, boot, cpu: processCpu(), lines: lines.slice(-120) }));
      return;
    }
    if (url.pathname === "/api/history") {
      sampleHistory();
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ bucketMs: HISTORY_BUCKET_MS, now: Date.now(), rows: history.list(), session: history.totals() }));
      return;
    }
    if (url.pathname === "/manifest.webmanifest") {
      res.writeHead(200, { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "no-store" });
      res.end(APP_MANIFEST);
      return;
    }
    if (url.pathname === "/icon.svg") {
      res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "max-age=3600" });
      res.end(APP_ICON_SVG);
      return;
    }
    const iconAt = /^\/icon-(192|512)\.png$/.exec(url.pathname);
    if (iconAt !== null) {
      res.writeHead(200, { "content-type": "image/png", "cache-control": "max-age=3600" });
      res.end(appIconPng(Number(iconAt[1])));
      return;
    }

    if (url.pathname === "/api/map") {
      const map = bot.liveMap();
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(map));
      return;
    }

    if (url.pathname === "/api/live") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      const f = bot.liveFrame();
      res.end(JSON.stringify(f === null ? null : { ...f, emoticons: emoticonList(), sounds: soundList() }));
      return;
    }

    const tilesAt = /^\/api\/scene\/tiles\/(\d+)$/.exec(url.pathname);
    const imageAt = /^\/api\/scene\/image\/(\d+)$/.exec(url.pathname);
    if (url.pathname === "/api/scene" || tilesAt !== null || imageAt !== null) {
      void sceneFor(url)
        .then(async (sc) => {
          if (sc === "other") {
            res.writeHead(409, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
            res.end("null");
            return;
          }
          if (tilesAt === null && imageAt === null) {
            res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
            res.end(JSON.stringify(sc === null ? null : sc.scene));
            return;
          }
          if (tilesAt !== null) {
            const data = sc?.tiles.get(Number(tilesAt[1]));
            if (data === undefined) {
              res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
              res.end(t("нет такого слоя"));
              return;
            }
            res.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "no-store" });
            res.end(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
            return;
          }
          const png = sc === null || imageAt === null ? null : await sc.png(Number(imageAt[1]));
          if (png === null) {
            res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
            res.end(t("нет такой картинки"));
            return;
          }
          res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
          res.end(png);
        })
        .catch((err: unknown) => {
          console.error("[web] scene:", err);
          if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
          res.end(t("внутренняя ошибка, подробности в логе бота"));
        });
      return;
    }

    if (url.pathname.startsWith("/skins/") && url.pathname.endsWith(".png")) {
      let name: string | null = null;
      try {
        name = safeSkinName(decodeURIComponent(url.pathname.slice("/skins/".length, -".png".length)));
      } catch {
        name = null;
      }
      const notFound = (): void => {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end(t("нет такого скина"));
      };
      if (name === null) {
        notFound();
        return;
      }
      const send = (file: string): void => sendFile(res, file, { "content-type": "image/png", "cache-control": "max-age=3600" });
      const local = firstExisting(skinFiles(name, assetRoot(), userDirCandidates(process.env), SKIN_CACHE_DIR));
      if (local !== null) {
        send(local);
        return;
      }

      if (readLaunch().skinDownload === "off" || req.headers["sec-fetch-site"] === "cross-site") {
        notFound();
        return;
      }
      void downloadSkin(name, SKIN_CACHE_DIR).then((file) => (file === null ? notFound() : send(file)));
      return;
    }

    if (url.pathname === "/overlay") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(OVERLAY_PAGE);
      return;
    }
    if (url.pathname === "/api/duelnow") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      const st = bot.status();
      const last = bot.duelList?.()[0] ?? null;

      const second = (st as { dummy?: { name?: string; duelScore?: { name: string; ours: number; theirs: number } | null } }).dummy;
      const mine = st.panel?.duelScore ?? null;
      const now = mine ?? second?.duelScore ?? null;
      const me = mine === null && now !== null ? (second?.name ?? "") : (st.name ?? "");
      res.end(JSON.stringify({ me, now, last: last === null ? null : { opponent: last.opponent, ours: last.ours, theirs: last.theirs, at: last.at, by: last.by ?? null } }));
      return;
    }

    if (url.pathname === "/api/duels") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });

      const all = bot.duelList?.() ?? [];

      const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
      const freezes = (k: "ours" | "theirs"): number => all.reduce((a, d) => a + num(d[k === "ours" ? "froze" : "frozen"] ?? (d.rounds === true ? 0 : d[k])), 0);
      const rounds = (k: "ours" | "theirs"): number => all.reduce((a, d) => a + (d.rounds === true ? num(d[k]) : 0), 0);
      res.end(JSON.stringify({ n: all.length, ours: freezes("ours"), theirs: freezes("theirs"), roundsOurs: rounds("ours"), roundsTheirs: rounds("theirs"), list: all.slice(0, DUEL_ROWS) }));
      return;
    }

    if (url.pathname === "/api/clips") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(bot.clipList?.() ?? []));
      return;
    }
    if (url.pathname.startsWith("/clips/")) {
      let name: string;
      try {
        name = decodeURIComponent(url.pathname.slice("/clips/".length));
      } catch {
        res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        res.end(t("плохое имя"));
        return;
      }
      const file = bot.clipPath?.(name) ?? null;
      if (file === null) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end(t("нет такой записи"));
        return;
      }
      sendFile(res, file, { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${name}"` });
      return;
    }

    if (url.pathname === "/api/knobs" && req.method !== "POST") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(bot.knobs?.() ?? []));
      return;
    }
    if (url.pathname === "/api/knobs" && req.method === "POST") {
      void readBody(req, 4 * 1024).then((raw) => {
        if (raw === null) {
          tooBig(req, res);
          return;
        }
        let reply = "";
        try {
          const body = JSON.parse(raw) as { key: string; value: unknown; reset?: boolean };
          reply = body.reset === true ? (bot.resetKnobs?.() ?? t("правка настроек недоступна")) : (bot.setKnob?.(body.key, body.value) ?? t("правка настроек недоступна"));
        } catch (err) {
          console.error("[web] knobs:", err);
          reply = t("внутренняя ошибка, подробности в логе бота");
        }
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ reply }));
      });
      return;
    }

    if (url.pathname === "/api/skins") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(skinNames()));
      return;
    }

    if (url.pathname === "/api/lan") {
      if (lan) {
        res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        res.end(t("только с этого компьютера"));
        return;
      }
      const send = (info: LanInfo): void => {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ ...info, qr: info.urls.slice(0, 4).map((u) => qrSvg(u)) }));
      };
      if (req.method === "POST") {
        void readBody(req, 1000).then((raw) => {
          if (raw === null) {
            tooBig(req, res);
            return;
          }
          let body: { on?: unknown; regen?: unknown } = {};
          try {
            const p = JSON.parse(raw) as unknown;
            if (p !== null && typeof p === "object") body = p as typeof body;
          } catch {
            body = {};
          }
          void (async () => {
            try {
              if (typeof body.on === "boolean") {
                store.write({ lan: body.on ? "on" : "off" });
                await setLanQueued(body.on);
              }

              if (body.regen === true) {
                if (gate !== null) gate.regenerate(true);
                else store.write({ lanCode: undefined });
              }
              send(lanInfo());
            } catch (err) {
              console.error("[web] lan:", err);
              res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
              res.end(JSON.stringify({ reply: t("внутренняя ошибка, подробности в логе бота") }));
            }
          })();
        });
        return;
      }
      send(lanInfo());
      return;
    }

    if (url.pathname === "/api/proxytest" && req.method === "POST") {
      if (lan) {
        res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        res.end(t("только с этого компьютера"));
        return;
      }
      const saved = readLaunch().proxy;
      const text = typeof saved === "string" ? saved.trim() : "";
      proxyTesting ??= (text === "" ? Promise.resolve({ ok: false, error: t("Прокси не задан"), ms: 0 }) : testProxy(text)).finally(() => {
        proxyTesting = null;
      });
      void proxyTesting.then((r) => {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify(r));
      });
      return;
    }

    if (url.pathname === "/api/lan/sessions") {
      if (lan) {
        res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        res.end(t("только с этого компьютера"));
        return;
      }
      const sendList = (): void => {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ sessions: gate === null ? [] : gate.sessionList() }));
      };
      if (req.method === "POST") {
        void readBody(req, 1000).then((raw) => {
          if (raw === null) {
            tooBig(req, res);
            return;
          }

          let body: { revokeAll?: unknown } = {};
          try {
            const p = JSON.parse(raw) as unknown;
            if (p !== null && typeof p === "object") body = p as typeof body;
          } catch {
            body = {};
          }
          if (body.revokeAll === true && gate !== null) {
            const n = gate.sessionList().length;
            gate.revokeAll();
            if (n > 0) push({ kind: "event", text: t("телефоны выведены из сессии: {n}", { n }) });
          }
          sendList();
        });
        return;
      }
      sendList();
      return;
    }

    if (url.pathname === "/api/launch") {
      if (req.method === "POST") {
        void readBody(req, 16 * 1024).then((raw) => {
          if (raw === null) {
            tooBig(req, res);
            return;
          }
          let reply = t("сохранено, применится после перезапуска");
          try {
            const body = JSON.parse(raw) as Record<string, unknown>;
            const cur = readLaunchStrict();

            if (cur === null) {
              console.error("[web] launch: settings.json is unreadable, the change is not saved");
              res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
              res.end(JSON.stringify({ reply: t("settings.json не читается") }));
              return;
            }

            if (typeof body.server === "string" && typeof cur.password === "string" && cur.password !== "" && !sameLaunchServer(cur.server, body.server)) {
              cur.password = "";
            }
            for (const k of ["server", "name", "clan", "skin", "ddnetData", "skinDownload", "dummy", "dummyName", "dummyClan", "dummySkin"]) {
              if (typeof body[k] === "string") cur[k] = body[k] as string;
            }
            writeJsonAtomic(LAUNCH_FILE, JSON.stringify(cur, null, 2));

            if (typeof body.ddnetData === "string") cachedRoot = undefined;
          } catch (err) {
            console.error("[web] launch:", err);

            const code = (err as NodeJS.ErrnoException)?.code;
            reply = t("внутренняя ошибка, подробности в логе бота") + (typeof code === "string" ? ` (${code})` : "");
          }
          res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ reply }));
        });
        return;
      }
      const cur = readLaunch();
      delete cur.password;

      delete (cur as Record<string, unknown>).lanCode;

      delete cur.llm;

      delete cur.proxy;
      delete cur.dummyProxy;

      const typed = typeof cur.ddnetData === "string" ? typedDataDir(cur.ddnetData) : { dir: null, note: "" };
      cur.ddnetDataNote = typed.note;
      if (!cur.ddnetData || typed.dir === null) cur.ddnetDataFound = defaultAssetRoot() ?? "";

      fetchMissingData();
      cur.ddnetGraphics = haveGraphics() ? "yes" : "";
      if (fetching !== null && cur.ddnetGraphics === "") cur.ddnetFetching = "yes";
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(cur));
      return;
    }

    const fontAt = /^\/page-fonts\/((?:Unbounded|GolosText|JetBrainsMono)-(?:latin|cyrillic)\.woff2)$/.exec(url.pathname);
    if (fontAt !== null) {
      sendFile(res, fileURLToPath(new URL(`fonts/${fontAt[1]}`, PAGE_DIR)), { "content-type": "font/woff2", "cache-control": "max-age=86400" });
      return;
    }

    if (url.pathname.startsWith("/assets/")) {
      let rel: string;
      try {
        rel = decodeURIComponent(url.pathname.slice("/assets/".length));
      } catch {
        res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        res.end(t("плохое имя"));
        return;
      }
      const ext = extname(rel).toLowerCase();
      const missing = (): void => {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end(t("нет такого файла"));
      };
      if (!ASSET_KINDS.has(ext) || rel.includes("\\") || rel.startsWith("/")) {
        missing();
        return;
      }
      void (async () => {
        const headers: http.OutgoingHttpHeaders = { "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream", "cache-control": "max-age=3600" };

        if (ext === ".ttf" || ext === ".otf") headers["access-control-allow-origin"] = "*";

        const foreign = req.headers["sec-fetch-site"] === "cross-site";
        const mayDownload = !foreign || CORE_DATA.includes(rel);
        const file = await findAsset(rel, mayDownload);
        if (file !== null) {
          sendFile(res, file, headers);
          return;
        }

        if (ext === ".wav" && rel.startsWith("audio/")) {
          const wv = await findAsset(rel.slice(0, -".wav".length) + ".wv", mayDownload);
          const wav = wv === null ? null : await wavOf(wv);
          if (wav !== null) {
            res.writeHead(200, { ...headers, "content-length": wav.length });
            res.end(wav);
            return;
          }
        }
        missing();
      })().catch(() => {
        if (!res.headersSent) missing();
      });
      return;
    }
    if (url.pathname === "/api/update" && req.method === "POST") {
      void (async () => {
        let reply = t("обновление недоступно: бот запущен без него");
        try {
          reply = (await bot.checkUpdate?.()) ?? reply;
        } catch (err) {
          console.error("[web] update:", err);
          reply = t("внутренняя ошибка, подробности в логе бота");
        }
        push({ kind: "event", text: t("обновление: {reply}", { reply }) });
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ reply }));
      })();
      return;
    }
    if (url.pathname === "/api/votes") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(bot.voteOptions?.() ?? []));
      return;
    }

    if (url.pathname === "/api/relations" && req.method !== "POST") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(bot.relationsInfo?.() ?? {}));
      return;
    }
    if (url.pathname === "/api/relation" && req.method === "POST") {
      void readBody(req, 1024).then((raw) => {
        if (raw === null) {
          tooBig(req, res);
          return;
        }
        let reply = "";
        try {
          const body = JSON.parse(raw) as { list?: unknown; name?: unknown; on?: unknown };
          const list = body.list === "war" || body.list === "friend" || body.list === "ignore" ? body.list : null;
          if (list !== null && typeof body.name === "string" && body.name.length <= 64) reply = bot.setRelation?.(list, body.name, body.on === true) ?? "";
        } catch (err) {
          console.error("[web] relation:", err);
          reply = t("внутренняя ошибка, подробности в логе бота");
        }
        if (reply !== "") push({ kind: "log", text: reply });
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ reply, lists: bot.relationsInfo?.() ?? {} }));
      });
      return;
    }
    if (url.pathname === "/api/llm" && req.method !== "POST") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(bot.llmInfo?.() ?? null));
      return;
    }

    if (url.pathname === "/api/llm" && req.method === "POST") {
      void readBody(req, 4 * 1024).then((raw) => {
        if (raw === null) {
          tooBig(req, res);
          return;
        }
        let reply = "";
        try {
          reply = bot.setLlm?.(JSON.parse(raw)) ?? "";
        } catch {
          reply = "";
        }
        res.writeHead(reply === "" ? 400 : 200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ reply }));
      });
      return;
    }
    if (url.pathname === "/api/autochat" && req.method !== "POST") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(bot.autoChatInfo?.() ?? null));
      return;
    }
    if (url.pathname === "/api/autochat" && req.method === "POST") {
      void readBody(req, 20 * 1024).then((raw) => {
        if (raw === null) {
          tooBig(req, res);
          return;
        }
        let cfg: unknown = null;
        try {
          cfg = bot.setAutoChat?.(JSON.parse(raw)) ?? null;
        } catch {
          cfg = null;
        }
        res.writeHead(cfg === null ? 400 : 200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(cfg));
      });
      return;
    }
    if (url.pathname === "/api/commands") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "max-age=60" });

      res.end(JSON.stringify(url.searchParams.get("full") === "1" ? (bot.commandList?.() ?? []) : (bot.commandNames?.() ?? [])));
      return;
    }
    if (url.pathname === "/api/config") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(bot.configInfo?.() ?? {}));
      return;
    }
    if (url.pathname === "/cmd" && req.method === "POST") {

      if (lan && !cmdLimit.take(parseCookies(req.headers.cookie).get(LAN_COOKIE) ?? "")) {
        req.resume();
        refuse(res, 429, JSON.stringify({ reply: t("слишком много команд, подожди секунду"), limited: true }), "application/json; charset=utf-8", { "retry-after": "1" });
        return;
      }
      void readBody(req, 8 * 1024).then(async (raw) => {
        if (raw === null) {
          tooBig(req, res);
          return;
        }
        let reply = "";
        let line = "";
        try {
          line = String((JSON.parse(raw) as { line?: string }).line ?? "");
          reply = (await bot.handleConsole(line)) ?? "";
        } catch (err) {
          console.error("[web] cmd:", err);
          reply = t("внутренняя ошибка, подробности в логе бота");
        }

        if (line !== "") push({ kind: "log", text: `> ${line}` });
        for (const l of reply.split("\n")) if (l.trim() !== "") push({ kind: "log", text: l });
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ reply }));
      });
      return;
    }

    const asked = url.searchParams.get("lang");
    const lang: Lang = asked === "en" ? "en" : asked === "ru" ? "ru" : getLang();
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": lan ? FRAME_ANCESTORS_LAN : FRAME_ANCESTORS });
    res.end(pageFor(lang));
  };

  let lanBusy: Promise<unknown> = Promise.resolve();
  const setLanQueued = (on: boolean): Promise<LanInfo> => {
    const next = lanBusy.then(() => setLan(on));
    lanBusy = next.catch(() => {});
    return next;
  };

  return new Promise<WebUi>((resolve, reject) => {
    server.once("error", reject);

    server.listen(port, "127.0.0.1", () => {

      server.off("error", reject);
      server.on("error", (err) => console.error("[web] server:", err.message));
      const addr = server.address();
      const up = typeof addr === "object" && addr !== null ? addr.port : port;
      resolve({
        port: up,
        push,
        close: () => {
          clearInterval(listen);
          clearInterval(sampler);
          server.close();
          lanBusy = lanBusy.then(() => setLan(false)).catch(() => {});
        },
        lanInfo,
        setLan: setLanQueued,
      });
    });
  }).then(async (ui: WebUi) => {
    if (opts.lan === true) await setLanQueued(true);
    return ui;
  });
}

function readBody(req: http.IncomingMessage, max: number): Promise<string | null> {
  return new Promise((resolve) => {
    let raw = "";
    let bytes = 0;
    let settled = false;
    const done = (v: string | null): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    req.setEncoding("utf8");
    req.on("data", (c: string) => {
      if (settled) return;
      bytes += Buffer.byteLength(c);
      if (bytes > max) {
        req.pause();
        done(null);
        return;
      }
      raw += c;
    });
    req.on("end", () => done(raw));
    req.on("error", () => done(null));
    req.on("close", () => done(null));
  });
}

function tooBig(req: http.IncomingMessage, res: http.ServerResponse, body = t("слишком большой запрос")): void {
  if (!res.headersSent) res.writeHead(413, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", connection: "close" });
  res.end(body, () => req.destroy());
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function sendFile(res: http.ServerResponse, file: string, headers: http.OutgoingHttpHeaders): void {
  const stream = createReadStream(file);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end(t("нет такого файла"));
    } else res.destroy();
  });
  stream.once("open", () => {
    res.writeHead(200, headers);
    stream.pipe(res);
  });
  res.once("close", () => stream.destroy());
}

const PAGE_DIR = new URL("./page/", import.meta.url);
const pages = new Map<Lang, string>();

function pageFor(lang: Lang): string {
  const have = pages.get(lang);
  if (have !== undefined) return have;
  const page = buildPage(lang, (name) => readFileSync(new URL(name, PAGE_DIR), "utf8"));
  pages.set(lang, page);
  return page;
}

export function isTestBuild(read: (name: string) => string): boolean {
  try {
    return (JSON.parse(read("build.json")) as { test?: unknown }).test === true;
  } catch {
    return false;
  }
}

export function buildPage(lang: Lang, read: (name: string) => string): string {

  let news: unknown = [];
  try {
    news = JSON.parse(read("whatsnew.json"));
  } catch {

  }
  const script = `const LANG=${JSON.stringify(lang)};\nconst EN=${JSON.stringify(EN)};\nconst NEWS=${JSON.stringify(news)};\nconst TEST_BUILD=${isTestBuild(read)};\nconst {t,tr}=(${makeT.toString()})(EN,LANG);\n${viewOpts.toString()}\n${pageScript()}\n${read("page.js")}`;
  const page = read("index.html")
    .replace('<html lang="ru">', () => `<html lang="${lang}"${lang === "en" ? ' class="i18n-wait"' : ""}>`)
    .replace("</head>", () => `<style>${read("page.css")}</style></head>`)
    .replace("</body>", () => `<script>${script.replace(/<\/script/gi, "<\\/script")}</script></body>`);
  return page;
}
