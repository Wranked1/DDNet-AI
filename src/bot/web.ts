import * as http from "node:http";
import { createReadStream, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { writeJsonAtomic } from "./atomicWrite.ts";
import { extname, join, resolve, sep } from "node:path";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { CONTENT_TYPES, DATA_CACHE_DIR, SKIN_CACHE_DIR, chosenAssets, dataDirCandidates, downloadData, downloadSkin, downloadableData, findDownloadedMap, firstExisting, pickDataDir, readIfSmall, safeSkinName, scanForUnpacked, skinFiles, steamLibraryData, typedDataDir, userDirCandidates, wavFromPcm } from "./webAssets.ts";
import decodeWavpack from "./wavpack/decode-wavpack.js";
import { SCENE_CACHE_DIR, parseSceneAsync } from "./webMap.ts";
import type { ParsedScene } from "./webMap.ts";
import { pageScript } from "./webPage.ts";
import { isAuto } from "./serverPick.ts";
import { LanGate, langOfHeader, lanHostOk, loginPage, privateAddresses, sessionCookie, validLanCode } from "./lan.ts";
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

function readLaunch(): Record<string, string> {
  try {

    const raw = JSON.parse(readFileSync(LAUNCH_FILE, "utf8").replace(/^\uFEFF/, "")) as Record<string, string>;
    return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
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

async function findAsset(rel: string): Promise<string | null> {
  const picked = chosenNow().get(rel);
  if (picked !== undefined && isFile(picked)) return picked;
  for (const root of [assetRoot(), DATA_CACHE_DIR]) {
    if (root === null) continue;
    const full = resolve(root, rel);
    if (full.startsWith(resolve(root) + sep) && isFile(full)) return full;
  }
  if (downloadsOn() && downloadableData(rel)) return downloadData(rel, DATA_CACHE_DIR);
  return null;
}

const CORE_DATA = ["game.png", "emoticons.png", "extras.png", "hud.png", "arrow.png", "particles.png", "editor/entities_clear/ddnet.png", "editor/speed_arrow.png", "fonts/DejaVuSans.ttf"];
let fetching: Promise<void> | null = null;
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
function wavOf(file: string): Promise<Buffer | null> {
  let job = wavs.get(file);
  if (job === undefined) {
    job = (async () => {
      try {
        const { channelData, sampleRate } = await decodeWavpack(readFileSync(file));
        return channelData.length > 0 && sampleRate > 0 ? wavFromPcm(channelData, sampleRate) : null;
      } catch {
        return null;
      }
    })();
    wavs.set(file, job);
  }
  return job;
}
import type { BotLine, BotStatus, DuelRow, LiveFrame, LiveMap } from "./bot.ts";

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

export type LanInfo = { on: boolean; listening: boolean; port: number; urls: string[]; code: string };

export type WebUi = { port: number; push: (line: BotLine) => void; close: () => void; lanInfo: () => LanInfo; setLan: (on: boolean) => Promise<LanInfo> };

export type WebOptions = {
  lan?: boolean;
  lanHosts?: string[];
  lanStore?: { read: () => { code?: string }; write: (patch: Record<string, unknown>) => void };
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

// Its #src line is an attribution notice required by NOTICE (GPLv3 section 7(b) additional terms): keep it in modified versions.
const OVERLAY_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>DDNet AI duel</title><style>
html,body{margin:0;background:transparent;color:#fff;font:800 56px/1.15 system-ui,"Segoe UI",sans-serif;text-shadow:0 2px 8px #000,0 0 3px #000}
#box{display:inline-flex;flex-direction:column;gap:4px;padding:14px 22px;border-radius:14px}
#box.bg{background:rgba(10,14,20,.72)}
#box[hidden]{display:none}
#row{display:flex;gap:.45em;align-items:baseline;white-space:nowrap}
.n{font-size:.62em;font-weight:700;max-width:9em;overflow:hidden;text-overflow:ellipsis}
#sc{font-variant-numeric:tabular-nums}
#sub{font:600 22px/1.2 system-ui,sans-serif;opacity:.85}
#src{font:600 13px/1.2 system-ui,sans-serif;opacity:.6}
#box.idle{opacity:.7}
</style></head><body><div id="box"><div id="row"><span class="n" id="me"></span><span id="sc"></span><span class="n" id="op"></span></div><div id="sub"></div><div id="src">DDNet AI · t.me/aiddnet</div></div>
<script>
const $=(id)=>document.getElementById(id);
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

export function startWebUi(bot: WebBot, port: number, version: string, opts: WebOptions = {}): Promise<WebUi> {

  const lines: (BotLine & { seq: number })[] = [];

  const boot = `${process.pid}-${Date.now().toString(36)}`;
  let seq = 0;

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

  const readSmall = (req: http.IncomingMessage, limit: number, done: (raw: string | null) => void): void => {
    let raw = "";
    let over = false;
    req.on("data", (c) => {
      if (over) return;
      raw += String(c);
      if (raw.length > limit) {
        over = true;
        done(null);
      }
    });
    req.on("end", () => {
      if (!over) done(raw);
    });
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
      readSmall(req, 256, (raw) => {
        if (raw === null) {
          refuse(res, 413, t("чужой запрос"));
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
      let raw = "";
      req.on("data", (c) => { raw += String(c); });
      req.on("end", () => {
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
        readSmall(req, 1000, (raw) => {
          let body: { on?: unknown; regen?: unknown } = {};
          try {
            body = JSON.parse(raw ?? "") as typeof body;
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

    if (url.pathname === "/api/launch") {
      if (req.method === "POST") {
        let raw = "";
        req.on("data", (c) => { raw += String(c); });
        req.on("end", () => {
          let reply = t("сохранено, применится после перезапуска");
          try {
            const body = JSON.parse(raw) as Record<string, unknown>;
            const cur = readLaunch();

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
        const file = await findAsset(rel);
        if (file !== null) {
          sendFile(res, file, headers);
          return;
        }

        if (ext === ".wav" && rel.startsWith("audio/")) {
          const wv = await findAsset(rel.slice(0, -".wav".length) + ".wv");
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
      let raw = "";
      req.on("data", (c) => { raw += String(c); });
      req.on("end", () => {
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
      let raw = "";
      req.on("data", (c) => {
        raw += String(c);
        if (raw.length > 4000) req.destroy();
      });
      req.on("end", () => {
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
      let raw = "";
      req.on("data", (c) => {
        raw += String(c);
        if (raw.length > 20000) req.destroy();
      });
      req.on("end", () => {
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
      res.end(JSON.stringify(bot.commandNames?.() ?? []));
      return;
    }
    if (url.pathname === "/api/config") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(bot.configInfo?.() ?? {}));
      return;
    }
    if (url.pathname === "/cmd" && req.method === "POST") {
      let raw = "";
      req.on("data", (c) => { raw += String(c); });
      req.on("end", async () => {
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
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
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
  const script = `const LANG=${JSON.stringify(lang)};\nconst EN=${JSON.stringify(EN)};\nconst NEWS=${JSON.stringify(news)};\nconst TEST_BUILD=${isTestBuild(read)};\nconst {t,tr}=(${makeT.toString()})(EN,LANG);\n${pageScript()}\n${read("page.js")}`;
  const page = read("index.html")
    .replace('<html lang="ru">', () => `<html lang="${lang}"${lang === "en" ? ' class="i18n-wait"' : ""}>`)
    .replace("</head>", () => `<style>${read("page.css")}</style></head>`)
    .replace("</body>", () => `<script>${script.replace(/<\/script/gi, "<\\/script")}</script></body>`);
  return page;
}
