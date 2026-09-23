import * as http from "node:http";
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { CONTENT_TYPES, SKIN_CACHE_DIR, dataDirCandidates, downloadSkin, findDownloadedMap, firstExisting, pickDataDir, readIfSmall, safeSkinName, scanForUnpacked, skinFiles, steamLibraryData, typedDataDir, userDirCandidates } from "./webAssets.ts";
import { parseSceneAsync } from "./webMap.ts";
import type { ParsedScene } from "./webMap.ts";
import { pageScript } from "./webPage.ts";

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
    const raw = JSON.parse(readFileSync(LAUNCH_FILE, "utf8")) as Record<string, string>;
    return typeof raw === "object" && raw !== null ? raw : {};
  } catch {
    return {};
  }
}
import type { BotLine, BotStatus, LiveFrame, LiveMap } from "./bot.ts";

export type WebBot = {
  status: () => BotStatus;
  statsLine: () => string;
  handleConsole: (line: string) => string;

  liveMap: () => LiveMap | null;
  liveFrame: () => LiveFrame | null;

  clipList?: () => { name: string; size: number; when: number }[];
  clipPath?: (name: string) => string | null;
  configInfo?: () => unknown;
  commandNames?: () => string[];

  voteOptions?: () => string[];
  checkUpdate?: () => Promise<string>;
  knobs?: () => { key: string; value: unknown; def: unknown; changed: boolean }[];
  setKnob?: (key: string, value: unknown) => string;

  mapData?: () => { name: string; bytes: Uint8Array } | null;

  emoticons?: () => { id: number; e: number; age: number }[];
};

type ClientLike = {
  map?: { mapBuffer?: Uint8Array; map_name?: string; downloading?: boolean; crc?: number; map_details?: { map_sha256?: Uint8Array } };
  on?: (event: string, fn: (m: { client_id: number; emoticon: number }) => void) => unknown;
};
function clientOf(bot: WebBot): ClientLike | null {
  const c = (bot as { client?: unknown }).client;
  return typeof c === "object" && c !== null ? (c as ClientLike) : null;
}

const MAX_LINES = 200;

export type WebUi = { port: number; push: (line: BotLine) => void; close: () => void };

export function startWebUi(bot: WebBot, port: number, version: string): Promise<WebUi> {

  const lines: (BotLine & { seq: number })[] = [];
  let seq = 0;

  const emotes = new Map<number, { e: number; at: number }>();
  let heard: ClientLike | null = null;
  const listen = setInterval(() => {
    const c = clientOf(bot);
    if (c === null || c === heard || typeof c.on !== "function") return;
    heard = c;
    try {
      c.on("emote", (m) => {
        if (typeof m?.client_id === "number" && m.client_id >= 0) emotes.set(m.client_id, { e: m.emoticon, at: Date.now() });
      });
    } catch {

    }
  }, 1000);
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
  const currentScene = (): Promise<ParsedScene | null> => {
    const want = sceneName();
    if (scene !== null && scene.name === want) {
      if (scene.job !== null) return scene.job;
      if (scene.parsed !== null || Date.now() - scene.at < 5000) return Promise.resolve(scene.parsed);
    }
    const entry: { name: string; parsed: ParsedScene | null; at: number; job: Promise<ParsedScene | null> | null } = { name: want, parsed: null, at: Date.now(), job: null };
    scene = entry;
    const src = mapBytes();
    if (src === null) return Promise.resolve(null);
    entry.job = parseSceneAsync(src.bytes, src.name)
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

  const ownHost = (h: string | undefined): boolean => {
    const addr = server.address();
    const p = typeof addr === "object" && addr !== null ? addr.port : port;
    return h === `127.0.0.1:${p}` || h === `localhost:${p}`;
  };
  const allowed = (req: http.IncomingMessage): boolean => {
    if (!ownHost(req.headers.host)) return false;
    if (req.method === "GET" || req.method === "HEAD") return true;
    if (req.headers["sec-fetch-site"] === "cross-site") return false;
    const origin = req.headers.origin;
    if (origin === undefined) return true;
    try {
      const o = new URL(origin);
      return o.protocol === "http:" && ownHost(o.host);
    } catch {
      return false;
    }
  };

  const server = http.createServer((req, res) => {
    if (!allowed(req)) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      res.end("чужой запрос");
      return;
    }

    try {
      route(req, res);
    } catch (err) {
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(err instanceof Error ? err.message : String(err));
    }
  });

  const route = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/api") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ status: bot.status(), stats: bot.statsLine(), version, lines: lines.slice(-120) }));
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
      res.end(JSON.stringify(f === null ? null : { ...f, emoticons: emoticonList() }));
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
              res.end("нет такого слоя");
              return;
            }
            res.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "no-store" });
            res.end(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
            return;
          }
          const png = sc === null || imageAt === null ? null : await sc.png(Number(imageAt[1]));
          if (png === null) {
            res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
            res.end("нет такой картинки");
            return;
          }
          res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
          res.end(png);
        })
        .catch((err: unknown) => {
          if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
          res.end(err instanceof Error ? err.message : String(err));
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
        res.end("нет такого скина");
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
        res.end("плохое имя");
        return;
      }
      const file = bot.clipPath?.(name) ?? null;
      if (file === null) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("нет такой записи");
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
          const body = JSON.parse(raw) as { key: string; value: unknown };
          reply = bot.setKnob?.(body.key, body.value) ?? "правка настроек недоступна";
        } catch (err) {
          reply = err instanceof Error ? err.message : String(err);
        }
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ reply }));
      });
      return;
    }

    if (url.pathname === "/api/launch") {
      if (req.method === "POST") {
        let raw = "";
        req.on("data", (c) => { raw += String(c); });
        req.on("end", () => {
          let reply = "сохранено, применится после перезапуска";
          try {
            const body = JSON.parse(raw) as Record<string, unknown>;
            const cur = readLaunch();
            for (const k of ["server", "name", "clan", "skin", "ddnetData", "skinDownload"]) {
              if (typeof body[k] === "string") cur[k] = body[k] as string;
            }
            writeFileSync(LAUNCH_FILE, JSON.stringify(cur, null, 2));

            if (typeof body.ddnetData === "string") cachedRoot = undefined;
          } catch (err) {
            reply = err instanceof Error ? err.message : String(err);
          }
          res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ reply }));
        });
        return;
      }
      const cur = readLaunch();
      delete cur.password;

      const typed = typeof cur.ddnetData === "string" ? typedDataDir(cur.ddnetData) : { dir: null, note: "" };
      cur.ddnetDataNote = typed.note;
      if (!cur.ddnetData || typed.dir === null) cur.ddnetDataFound = defaultAssetRoot() ?? "";

      const root = assetRoot();
      cur.ddnetGraphics = root !== null && existsSync(join(root, "game.png")) ? "yes" : "";
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(cur));
      return;
    }

    if (url.pathname.startsWith("/assets/")) {
      const root = assetRoot();
      let rel: string;
      try {
        rel = decodeURIComponent(url.pathname.slice("/assets/".length));
      } catch {
        res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        res.end("плохое имя");
        return;
      }
      const full = root === null ? null : resolve(root, rel);
      const ok = root !== null && full !== null && full.startsWith(resolve(root) + sep) && ASSET_KINDS.has(extname(full).toLowerCase()) && isFile(full);
      if (!ok) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("нет такого файла");
        return;
      }
      const ext = extname(full).toLowerCase();
      const headers: http.OutgoingHttpHeaders = { "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream", "cache-control": "max-age=3600" };

      if (ext === ".ttf" || ext === ".otf") headers["access-control-allow-origin"] = "*";
      sendFile(res, full, headers);
      return;
    }
    if (url.pathname === "/api/update" && req.method === "POST") {
      void (async () => {
        let reply = "обновление недоступно: бот запущен без него";
        try {
          reply = (await bot.checkUpdate?.()) ?? reply;
        } catch (err) {
          reply = err instanceof Error ? err.message : String(err);
        }
        push({ kind: "event", text: `обновление: ${reply}` });
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
      req.on("end", () => {
        let reply = "";
        let line = "";
        try {
          line = String((JSON.parse(raw) as { line?: string }).line ?? "");
          reply = bot.handleConsole(line) ?? "";
        } catch (err) {
          reply = err instanceof Error ? err.message : String(err);
        }

        if (line !== "") push({ kind: "log", text: `> ${line}` });
        for (const l of reply.split("\n")) if (l.trim() !== "") push({ kind: "log", text: l });
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ reply }));
      });
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(PAGE);
  };

  return new Promise((resolve, reject) => {
    server.once("error", reject);

    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        port: typeof addr === "object" && addr !== null ? addr.port : port,
        push,
        close: () => {
          clearInterval(listen);
          server.close();
        },
      });
    });
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
      res.end("нет такого файла");
    } else res.destroy();
  });
  stream.once("open", () => {
    res.writeHead(200, headers);
    stream.pipe(res);
  });
  res.once("close", () => stream.destroy());
}

const PAGE = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ddnet-ai</title><style>

@font-face{font-family:"DejaVu Sans DDNet";src:local("DejaVu Sans"),url(/assets/fonts/DejaVuSans.ttf) format("truetype");font-display:swap}
:root{--bg:#99a3c5;--bg2:#6f7896;--panel:rgba(0,0,0,.25);--panel2:rgba(0,0,0,.5);--line:rgba(255,255,255,.15);--ink:#fff;--dim:rgba(255,255,255,.75);
 --ok:#9fe8b0;--bad:#ffb09c;--acc:#cfe3ff;--btn:rgba(255,255,255,.5);--btnh:rgba(255,255,255,.6);--btna:rgba(255,255,255,.4);
 --sq:5vh;--shade:0 1px 2px rgba(0,0,0,.45);
 --solid:#3b424b;--nohook:#6d5c44;--tele:#8a5fb0;--trap:rgba(224,139,118,.16);--freeze:#4d8fc9;--death:#9c463a;--unfreeze:#579a6a;--sky:#1d2432;
 --font:"DejaVu Sans DDNet","DejaVu Sans","Segoe UI",ui-sans-serif,system-ui,sans-serif}
*{box-sizing:border-box}

*{scrollbar-width:auto;scrollbar-color:#ccc rgba(255,255,255,.25)}
::-webkit-scrollbar{width:16px;height:16px}
::-webkit-scrollbar-track{background:rgba(255,255,255,.25);border:4px solid transparent;background-clip:padding-box;border-radius:8px}
::-webkit-scrollbar-thumb{background:#ccc;border:4px solid transparent;background-clip:padding-box;border-radius:8px;min-height:36px}
::-webkit-scrollbar-thumb:hover{background:#fff;background-clip:padding-box}
::-webkit-scrollbar-thumb:active{background:#e6e6e6;background-clip:padding-box}
::-webkit-scrollbar-corner,::-webkit-scrollbar-button{background:transparent;width:0;height:0}

html{background:var(--bg);overflow:hidden}
body{margin:0;color:var(--ink);font:13.5px/1.5 var(--font);height:100vh;overflow:hidden;text-shadow:var(--shade)}
body::before{content:"";position:fixed;left:calc(var(--sq)*-4);top:calc(var(--sq)*-4);width:calc(100vw + var(--sq)*8);height:calc(100vh + var(--sq)*8);z-index:-2;pointer-events:none;
 background:conic-gradient(rgba(0,0,0,.045) 25%,transparent 0 50%,rgba(0,0,0,.045) 0 75%,transparent 0) 0 0/calc(var(--sq)*2) calc(var(--sq)*2);
 animation:ddbg 13.333s linear infinite}
body::after{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background:radial-gradient(ellipse at 50% 45%,transparent 50%,rgba(0,0,0,.3) 100%)}
@keyframes ddbg{from{transform:translate(0,0)}to{transform:translate(calc(var(--sq)*-4),calc(var(--sq)*2))}}
@media(prefers-reduced-motion:reduce){body::before{animation:none}}
html.embedded{background:transparent}
html.embedded body::before,html.embedded body::after{display:none}
.wrap{max-width:1600px;margin:0 auto;padding:12px 14px 10px;height:100vh;display:flex;flex-direction:column;min-height:0}

.tabs{display:flex;align-items:flex-end;gap:3px;flex-wrap:wrap}
.tabs .tabsp{flex:1}
.tabs .who{display:flex;align-items:center;gap:8px;font-size:13px;padding:0 10px 7px}
.tabs .ver{padding:0 6px 7px}
.tab{background:rgba(0,0,0,.25);color:#fff;border:0;border-radius:10px 10px 0 0;padding:9px 28px;font:inherit;font-size:14px;cursor:pointer;text-shadow:var(--shade);
 transition:background .12s}
.tab:hover{background:rgba(255,255,255,.25)}
.tab.on{background:var(--panel2)}
section[data-pane]{flex:1;display:flex;flex-direction:column;min-height:0;background:var(--panel2);border-radius:0 10px 10px 10px;padding:10px}

section[data-pane][hidden]{display:none}
.game-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(250px,330px);gap:10px;flex:1;min-height:0;align-items:stretch}
.game-grid>.card{min-width:0;display:flex;flex-direction:column;min-height:0;padding:10px;margin:0}
.game-grid .side{display:flex;flex-direction:column;gap:10px;min-width:0;min-height:0}
.game-grid .side>.card{margin:0}
.game-grid .side>.logcard{flex:1;min-height:120px;display:flex;flex-direction:column}
.logcard .log{flex:1;height:auto;min-height:0}
@media(max-width:900px){.game-grid{grid-template-columns:minmax(0,1fr)}}
.card{background:var(--panel);border-radius:10px;padding:12px 14px;margin-bottom:10px}
.card>.k:first-child{margin:-12px -14px 10px;padding:7px 14px;background:rgba(0,0,0,.2);border-radius:10px 10px 0 0;color:#fff;font-size:12px;letter-spacing:.04em}
details.card>summary{margin:-12px -14px 0;padding:8px 14px;background:rgba(0,0,0,.2);border-radius:10px;color:#fff;font-size:12.5px;cursor:pointer;list-style:none}
details.card[open]>summary{margin-bottom:10px;border-radius:10px 10px 0 0}
details.card:not([open]){padding-bottom:0;padding-top:0}
details.card:not([open])>summary{margin:0 -14px}
details.card>summary::-webkit-details-marker{display:none}
details.card>summary::before{content:"▸ "}
details.card[open]>summary::before{content:"▾ "}
section[data-pane] .card:last-child{margin-bottom:0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:10px 14px}
.k{color:var(--dim);font-size:11px;margin-bottom:2px;letter-spacing:.03em}
.v{font-variant-numeric:tabular-nums}
.dot{width:8px;height:8px;border-radius:50%;background:var(--dim);flex:none}
.dot.on{background:var(--ok);box-shadow:0 0 6px rgba(159,232,176,.7)}.dot.off{background:var(--bad)}
.ver{margin-left:auto;color:var(--dim);font-size:12px;font-variant-numeric:tabular-nums}
.log{height:220px;overflow:auto;background:rgba(0,0,0,.25);border-radius:6px;padding:7px 10px;font:12px/1.55 var(--font);white-space:pre-wrap;word-break:break-word}
.log div{padding:1px 0}
.chat{color:#fff}.evt{color:var(--acc)}.wsp{color:#ffa8a8}.sys{color:#ffff80}
form{display:flex;gap:8px;margin:0}
input[type=text]{flex:1;min-width:0;background:rgba(0,0,0,.25);color:#fff;border:0;border-radius:5px;padding:7px 10px;font:inherit}
input[type=text]::placeholder{color:rgba(255,255,255,.45)}
input:focus{outline:2px solid rgba(255,255,255,.5);outline-offset:-2px}

button{background:var(--btn);color:#fff;border:0;border-radius:5px;padding:7px 16px;font:inherit;font-size:13px;cursor:pointer;transition:background .1s;text-shadow:var(--shade)}
button:hover{background:var(--btnh)}
button:active{background:var(--btna)}
button.ghost{background:rgba(0,0,0,.25);color:#fff;padding:6px 12px;font-size:12.5px}
button.ghost:hover{background:rgba(128,128,128,.25)}
button.ghost:active{background:rgba(38,38,38,.25)}
button.ghost.on{background:var(--btn)}
button.ghost.on:hover{background:var(--btnh)}
select{background:rgba(0,0,0,.25);color:#fff;border:0;border-radius:5px;padding:6px 8px;font:inherit;font-size:12.5px;max-width:180px}
select option{background:#2c3850}
.hint{color:var(--dim);font-size:12px;margin-top:8px}
.fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px 16px}
.fields label{display:flex;flex-direction:column;gap:4px;color:var(--dim);font-size:12px}
.fields input{background:rgba(0,0,0,.25);color:#fff;border:0;border-radius:5px;padding:7px 9px;font:inherit}
label.check{display:flex;align-items:center;gap:8px;color:#fff;font-size:12.5px;margin-top:10px;cursor:pointer}
table.ab{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;table-layout:fixed}
table.ab input{width:110px;background:rgba(0,0,0,.25);color:#fff;border:0;border-radius:4px;padding:3px 6px;font:inherit;font-size:12px}
table.ab tr.changed td:first-child{color:var(--acc)}
table.ab td{overflow:hidden;text-overflow:ellipsis}
table.ab td,table.ab th{padding:4px 8px;text-align:right;font-weight:400}
table.ab tr:nth-child(even) td{background:rgba(255,255,255,.04)}
table.ab th{color:var(--dim);font-size:11.5px;background:rgba(0,0,0,.2)}
table.ab td:first-child,table.ab th:first-child{text-align:left}
table.ab a{color:var(--acc)}
td.num{font-variant-numeric:tabular-nums}
.view{position:relative;border-radius:10px;overflow:hidden;background:var(--sky);box-shadow:0 10px 30px rgba(0,0,0,.35)}

.chat-ov{position:absolute;left:0;bottom:0;width:min(66%,600px);pointer-events:none;padding:10px;display:flex;flex-direction:column;gap:4px}
.chat-lines{max-height:170px;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;gap:2px;font:12.5px/1.45 var(--font)}
.chat-lines div{flex:none;color:#fff;padding:1px 8px 1px 6px;align-self:flex-start;max-width:100%;word-break:break-word;border-radius:7px;background:rgba(0,0,0,.2);
 text-shadow:0 0 2px #000,0 1px 2px rgba(0,0,0,.9);transition:opacity .6s}
.chat-lines div img.tee{width:1.35em;height:1.35em;vertical-align:-.36em;margin:0 3px 0 -2px}
.chat-lines div b{font-weight:400;color:#fff}
.chat-lines div.team{color:#a6f2a6}.chat-lines div.team b{color:#a6f2a6}
.chat-lines div.wsp,.chat-lines div.wsp b{color:#ffa3a3}
.chat-lines div.hl{color:#ff8080}
.chat-lines div.sys{color:#ffff80}
.chat-lines div.evt{color:#bfe3ff}
.chat-lines div.me{color:#c6d8ff}
.chat-ov.open .chat-lines{background:rgba(0,0,0,.15);border-radius:6px;padding:4px 2px}
.chat-in[hidden]{display:none}
.chat-in{pointer-events:auto;display:flex;align-items:center;gap:6px;background:rgba(0,0,0,.4);border-radius:5px;padding:4px 8px;font:12.5px/1.5 var(--font)}
.chat-prompt{color:#fff;flex:none}
.chat-in input{flex:1;min-width:0;background:transparent;border:0;outline:0;color:#fff;font:inherit;padding:2px 0}
.chat-tip{color:rgba(255,255,255,.55);flex:none;white-space:nowrap;overflow:hidden;max-width:45%}
.game-grid>.card>.view{flex:1;min-height:180px}
canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab}
canvas.drag{cursor:grabbing}
.bar{display:flex;align-items:center;gap:6px;margin-top:8px;flex-wrap:wrap}
.bar .sp{flex:1}
.bar .sep{width:1px;height:18px;background:rgba(255,255,255,.15);margin:0 3px}
.statusbar{display:flex;align-items:center;gap:10px;margin-top:8px;padding:7px 12px;border-radius:6px;background:rgba(0,0,0,.25);font-size:12px;font-variant-numeric:tabular-nums}
.statusbar .sp{flex:1}
.statusbar #vinfo2{color:var(--dim)}
.legend{gap:12px}
.legend .k{margin:0}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;vertical-align:-1px}

input[type=range]{-webkit-appearance:none;appearance:none;width:130px;height:20px;background:transparent;cursor:pointer}
input[type=range]::-webkit-slider-runnable-track{height:8px;border-radius:4px;background:rgba(255,255,255,.25)}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:14px;margin-top:-3px;border-radius:7px;background:#ccc}
input[type=range]:hover::-webkit-slider-thumb{background:#fff}
input[type=range]::-moz-range-track{height:8px;border-radius:4px;background:rgba(255,255,255,.25)}
input[type=range]::-moz-range-thumb{width:22px;height:14px;border:0;border-radius:7px;background:#ccc}
.bottombar{display:flex;align-items:center;gap:8px;margin-top:10px;padding:8px 10px;border-radius:10px;background:var(--panel)}
.bottombar form{flex:1;min-width:200px}
.bottombar{flex-wrap:wrap}
.bottombar .sep{width:1px;height:18px;background:rgba(255,255,255,.18);margin:0 2px}
.votesbox{position:relative}
.votes{position:absolute;right:0;bottom:calc(100% + 8px);width:min(420px,80vw);max-height:50vh;display:flex;flex-direction:column;gap:6px;padding:8px;
 background:rgba(0,0,0,.6);backdrop-filter:blur(10px);border-radius:10px;z-index:20}
.votes[hidden]{display:none}
.vlist{overflow:auto;display:flex;flex-direction:column;gap:2px}
.vlist button{background:rgba(0,0,0,.25);text-align:left;padding:6px 10px}
.vlist button:hover{background:rgba(255,255,255,.25)}
.vlist .none{color:var(--dim);padding:6px 4px}

.voteban{position:absolute;top:10px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;max-width:80%;padding:6px 8px 6px 14px;
 background:rgba(0,0,0,.55);border-radius:10px;z-index:3;font-size:13px}
.voteban[hidden]{display:none}
.voteban span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.voteban button{padding:4px 10px;font-size:12px;white-space:nowrap;flex:none}
.footline{display:flex;gap:14px;align-items:center;color:var(--dim);font-size:11px;padding:8px 4px 0}
.credits{color:var(--dim);font-size:11.5px;line-height:1.5;margin-top:10px}
.credits b{color:#fff;font-weight:400}

html.mini .wrap{padding:0;max-width:none;min-height:0;height:100vh}
html.mini .tabs,html.mini .game-grid>.side,html.mini .bar,html.mini .bottombar,html.mini .footline,html.mini section[data-pane="game"]>.card{display:none}
html.mini section[data-pane]{border:0;border-radius:0;padding:0;background:none}
html.mini .game-grid{display:block}
html.mini .game-grid>.card{margin:0;padding:0;border-radius:0;background:none}
html.mini .view{border-radius:0;box-shadow:none}
html.mini canvas{height:calc(100vh - 29px)}
html.mini .statusbar{margin:0;border-radius:0;padding:4px 10px;font-size:11px}
html.mini .chat-lines{font-size:11px;max-height:84px}
</style></head><body><div class="wrap">
<div class="tabs">
 <button class="tab on" data-tab="game" type="button">Игра</button>
 <button class="tab" data-tab="cfg" type="button">Настройки</button>
 <span class="tabsp"></span>
 <span class="who"><span class="dot" id="dot"></span><span id="head">…</span></span>
 <span class="ver" id="ver"></span>
</div>
<section data-pane="game">
<div class="game-grid">
<div class="card">
 <div class="view"><canvas id="cv"></canvas>
  <div class="voteban" id="voteban" hidden><span id="vtext"></span><button data-cmd="!yes" type="button">F3 за</button><button data-cmd="!no" type="button">F4 против</button></div>
  <div class="chat-ov" id="chatov">
   <div class="chat-lines" id="chatlines"></div>
   <div class="chat-in" id="chatin" hidden><span class="chat-prompt" id="chatprompt">Все:</span><input type="text" id="chatfield" autocomplete="off" spellcheck="false"><span class="chat-tip" id="chattip"></span></div>
  </div>
 </div>
 <div class="bar">
  <button class="ghost on" id="follow" type="button">следить</button>
  <select id="spec" title="За кем следить: можно и кликнуть по ти на экране"><option value="-1">за ботом</option></select>
  <button class="ghost" id="whole" type="button">вся карта</button>
  <input type="range" id="zoom" min="3" max="300" value="100" title="масштаб">
  <span class="sep"></span>
  <button class="ghost" id="tmode" type="button" title="Как в дднете: карта, сущности или вместе">вид: карта</button>
  <button class="ghost on" id="tnames" type="button">ники</button>
  <button class="ghost on" id="tcursor" type="button" title="Куда целится бот">прицел</button>
  <button class="ghost on" id="troute" type="button">маршрут</button>
  <button class="ghost on" id="ttraps" type="button">ловушки</button>
  <button class="ghost" id="tboard" type="button" title="То же, что удерживать Tab">табло</button>
  <button class="ghost" id="tsound" type="button">звук</button>
  <span class="sp"></span>
 </div>
 <div class="statusbar"><span id="doing">—</span><span class="sp"></span><span id="vinfo2"></span></div>
 <div class="bar legend" id="legend">
  <span class="k"><i style="background:var(--solid)"></i> за это цепляется</span>
  <span class="k"><i style="background:var(--nohook)"></i> не цепляется</span>
  <span class="k"><i style="background:var(--freeze)"></i> фриз</span>
  <span class="k"><i style="background:var(--unfreeze)"></i> разморозка</span>
  <span class="k"><i style="background:var(--death)"></i> смерть</span>
  <span class="k"><i style="background:var(--tele)"></i> телепорт</span>
 </div>
</div>
<div class="side">
 <div class="card"><div class="k" style="margin-bottom:8px">Состояние</div><div class="grid" id="grid"></div></div>
 <div class="card logcard">
<div class="bar" style="margin:0 0 8px">
 <button class="ghost on" data-filter="all" type="button">всё</button>
 <button class="ghost" data-filter="chat" type="button">чат</button>
 <button class="ghost" data-filter="evt" type="button">события</button>
 <button class="ghost" data-filter="wsp" type="button">личные</button>
 <input type="text" id="find" placeholder="поиск по логу" style="flex:1;min-width:120px">
</div>
<div class="log" id="log"></div>
 </div>
</div>
</div>
<div class="bottombar">
 <form id="f"><input type="text" id="i" placeholder="команда, например !stats или !try off" autocomplete="off"></form>
 <button id="send" type="button">Отправить</button>
 <span class="sep"></span>
 <button class="ghost" data-cmd="!yes" type="button" title="Голос за в идущем голосовании (F3)">F3 за</button>
 <button class="ghost" data-cmd="!no" type="button" title="Голос против (F4)">F4 против</button>
 <button class="ghost" data-cmd="!kill" type="button" title="/kill за бота">убиться</button>
 <button class="ghost" data-cmd="!spec" type="button" title="Бот уходит в наблюдатели">наблюдать</button>
 <button class="ghost" data-cmd="!join" type="button" title="Обратно в игру">в игру</button>
 <select id="emo" title="Эмоция бота"><option value="">эмоция</option><option value="hearts">сердечки</option><option value="exclamation">!</option><option value="question">?</option><option value="sorry">извини</option><option value="drop">капля</option><option value="splat">splat</option><option value="zzz">zzz</option></select>
 <span class="votesbox"><button class="ghost" id="votesbtn" type="button" title="Голосования сервера: карты и прочее">голосования</button>
  <div class="votes" id="votes" hidden><input type="text" id="vfind" placeholder="поиск" autocomplete="off"><div class="vlist" id="vlist"></div></div></span>
</div>
<div class="footline"><span id="footver">—</span><span>Enter в экране: чат · Tab: подсказки · удержание Tab: табло · клик по ти: следить за ним</span></div>
</section>

<section data-pane="cfg" hidden>
<div class="card">
 <div class="k" style="margin-bottom:6px">Сейчас</div>
 <div class="grid" id="info"></div>
</div>
<div class="card">
 <div class="k" style="margin-bottom:8px">Бот</div>
 <div class="fields">
  <label>Сервер<input type="text" id="s_server" placeholder="ip:порт"></label>
  <label>Имя<input type="text" id="s_name"></label>
  <label>Клан<input type="text" id="s_clan"></label>
  <label>Скин<input type="text" id="s_skin"></label>
 </div>
 <div class="bar"><button id="s_save" type="button">Сохранить</button>
  <button class="ghost" id="s_update" type="button">Проверить обновление</button>
  <span class="k" id="s_note" style="margin:0"></span></div>
 <div class="hint">Сервер, имя, клан и скин применяются при следующем запуске бота.</div>
 <div class="bar" style="margin-top:12px">
  <button class="ghost" data-cmd="!mode fight" type="button">драться</button>
  <button class="ghost" data-cmd="!mode passive" type="button">не лезть</button>
  <button class="ghost" data-cmd="!stop" type="button">стоять</button>
  <button class="ghost" data-cmd="!go" type="button">играть</button>
 </div>
</div>
<div class="card">
 <div class="k" style="margin-bottom:8px">Графика DDNet</div>
 <div class="fields">
  <label>Папка data установки DDNet<input type="text" id="s_ddnetData" placeholder="пусто: найти самому"></label>
 </div>
 <label class="check"><input type="checkbox" id="s_skinDownload" checked> качать скины, которых нет у тебя, из общей базы скинов DDNet (skins.ddnet.org)</label>
 <div class="bar"><button id="s_save2" type="button">Сохранить</button><span class="k" id="s_gfx" style="margin:0"></span></div>
 <div class="credits" id="credits">Карта, скины, оружие, эмоции и шрифт в окне рисуются файлами <b>DDNet / Teeworlds</b> (data: CC-BY-SA 3.0; скины, шрифты и ассеты под своими лицензиями, у каждого автора свои). В бота они не входят: окно берёт их из твоей установки DDNet во время работы, а скины, которых у тебя нет, скачивает из общей базы DDNet в runs/skincache (это выключается галочкой выше). Тайлсеты, встроенные в саму карту, приходят с картой. Нет установки: стены, фриз и ти, для которых нет картинок, окно рисует своей графикой. Код отрисовки частично повторяет исходники DDNet (zlib).</div>
</div>
<details class="card"><summary>Записи <span class="k" id="clipn"></span></summary>
 <table id="clipt" class="ab" style="margin-top:8px"></table>
 <div class="bar"><button class="ghost" id="clipref" type="button">обновить</button></div>
</details>
<details class="card"><summary>Для продвинутых — настройки поиска</summary>
 <div class="hint">Меняются на лету: бот пересобирает поиск со следующего решения. Изменённое подсвечено; пустое поле возвращает значение по умолчанию.</div>
 <table id="knobs" class="ab" style="margin-top:8px"></table>
</details>
</section>
</div><script>
{const mini=()=>{try{document.documentElement.classList.toggle('mini',/[?&]view=mini(&|$)/.test(location.search)||location.hash==='#mini')}catch{}};mini();try{addEventListener('hashchange',mini)}catch{}}
try{if(window.self!==window.top)document.documentElement.classList.add('embedded')}catch{}
const $=(s)=>document.querySelector(s);
let stick=true,lastStatus=null,lastVersion='';
let map=null,mapName='',frame=null,prevFrame=null,view=null,dataFound=false;
let lines=[],chatOpen=false,chatSeen=-1,boardHeld=false;
let ac=null,muted=true;
const snd={},hist=[],seenAt=new Map();let hix=-1;
const modeNames={map:'вид: карта',ent:'вид: сущности',both:'вид: вместе'};
${pageScript()}
for(const b of document.querySelectorAll('.tab')){
 b.addEventListener('click',()=>{
  for(const o of document.querySelectorAll('.tab'))o.className='tab'+(o===b?' on':'');
  for(const p of document.querySelectorAll('[data-pane]'))p.hidden=p.dataset.pane!==b.dataset.tab;
  if(b.dataset.tab==='cfg'){pullConfig();pullClips();pullKnobs();pullLaunch();}
 });
}
let logFilter='all', logFind='';
for(const b of document.querySelectorAll('[data-filter]')){
 b.addEventListener('click',()=>{
  logFilter=b.dataset.filter;
  for(const o of document.querySelectorAll('[data-filter]'))o.className='ghost'+(o===b?' on':'');
  renderLog();
 });
}
$('#find').addEventListener('input',(e)=>{logFind=e.target.value.toLowerCase();renderLog()});
for(const b of document.querySelectorAll('[data-cmd]')){
 b.addEventListener('click',()=>{$('#i').value=b.dataset.cmd;$('#f').requestSubmit()});
}
async function botCmd(v){try{await fetch('/cmd',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({line:v})})}catch{}}
$('#emo').addEventListener('change',()=>{const v=$('#emo').value;if(v)botCmd('!emote '+v);$('#emo').value=''});
let voteList=[];
function renderVotes(){
 const q=($('#vfind').value||'').toLowerCase();
 const rows=voteList.filter((v)=>!q||v.toLowerCase().includes(q)).slice(0,200);
 $('#vlist').innerHTML=rows.length?rows.map((v,i)=>'<button type="button" data-vote="'+i+'">'+esc(v)+'</button>').join(''):'<div class="none">'+(voteList.length?'ничего не нашлось':'сервер не предлагает голосований')+'</div>';
 for(const b of $('#vlist').querySelectorAll('[data-vote]'))b.addEventListener('click',()=>{const v=rows[Number(b.dataset.vote)];if(v!==undefined)botCmd('!vote '+v);$('#votes').hidden=true});
}
$('#votesbtn').addEventListener('click',async()=>{
 const box=$('#votes');box.hidden=!box.hidden;if(box.hidden)return;
 try{voteList=await(await fetch('/api/votes')).json()}catch{voteList=[]}
 renderVotes();$('#vfind').focus();
});
$('#vfind').addEventListener('input',renderVotes);
$('#vfind').addEventListener('keydown',(e)=>{if(e.key==='Escape')$('#votes').hidden=true});
let voteSeen=0,voteTimer=0;
function watchVotes(){
 for(const l of lines){
  if(!(l.seq>voteSeen))continue;voteSeen=l.seq;
  const t=String(l.text||'');
  const m=t.match(/called (?:for )?vote to (?:change server option|kick|mute|move|pause) ['‘]?(.+?)['’]? ?(?:\\((.*)\\))?$/i)||t.match(/called (?:for )?vote to (.+)$/i);
  if(m){$('#vtext').textContent='Голосование: '+m[1]+(m[2]?' ('+m[2]+')':'');$('#voteban').hidden=false;clearTimeout(voteTimer);voteTimer=setTimeout(()=>{$('#voteban').hidden=true},30000)}
  else if(/vote (passed|failed|aborted)|vote was (passed|failed)|you voted/i.test(t)){$('#voteban').hidden=true}
 }
}
$('#clipref').addEventListener('click',pullClips);
if($('#s_update'))$('#s_update').addEventListener('click',async()=>{
 $('#s_note').textContent='проверяю...';
 try{const r=await(await fetch('/api/update',{method:'POST'})).json();$('#s_note').textContent=r.reply||'готово'}
 catch{$('#s_note').textContent='не вышло проверить'}
});
if($('#send'))$('#send').addEventListener('click',()=>$('#f').requestSubmit());
function human(n){return n>1048576?(n/1048576).toFixed(1)+' МБ':(n/1024).toFixed(0)+' КБ'}
async function pullClips(){
 try{const list=await(await fetch('/api/clips')).json();
  $('#clipt').innerHTML='<tr><th>запись</th><th>размер</th><th>когда</th></tr>'+
   ($('#clipn')?($('#clipn').textContent=list.length?'· '+list.length:''):0,list.length?list.map((c)=>'<tr><td><a href="/clips/'+encodeURIComponent(c.name)+'" download>'+esc(c.name)+'</a></td><td class="num">'+human(c.size)+'</td><td class="num">'+new Date(c.when).toLocaleTimeString()+'</td></tr>').join('')
    :'<tr><td colspan="3" style="color:var(--dim)">записей пока нет</td></tr>');
 }catch{}
}
async function pullConfig(){
 try{const c=await(await fetch('/api/config')).json();
  const st=lastStatus||{};
  $('#info').innerHTML=[
   cell('Сервер',esc(st.server||'—')),cell('Состояние',st.phase==='online'?'в игре':(st.offlineReason||st.phase||'—')),
   cell('Имя',esc(st.name||'—')),cell('Карта',esc(c.map||'—')),
   cell('Мозг',esc(st.brain||'—')),cell('Режим',st.acting?esc(st.mode||'—'):'стоит'),
   cell('Версия',esc((lastVersion||'').slice(0,7)||'—')),cell('Ловушек',(c.traps||0)+' тайлов'),
   cell('Память',c.memory?c.memory.events+' заморозок':'выключена')
  ].join('');
 }catch{}
}
async function pullLaunch(){
 try{const l=await(await fetch('/api/launch')).json();
  for(const k of ['server','name','clan','skin','ddnetData'])if($('#s_'+k))$('#s_'+k).value=l[k]||'';
  if($('#s_ddnetData')&&!l.ddnetData)$('#s_ddnetData').placeholder=l.ddnetDataFound?('найдено: '+l.ddnetDataFound):'не нашёл: впиши путь к папке data';
  if($('#s_skinDownload'))$('#s_skinDownload').checked=l.skinDownload!=='off';
  if($('#s_gfx'))$('#s_gfx').textContent=(l.ddnetDataNote?l.ddnetDataNote+(l.ddnetDataFound?'; нашёл сам: '+l.ddnetDataFound:'')+'. ':'')+(l.ddnetGraphics?'графика DDNet найдена':'графики DDNet нет, рисую своей');
  loadAssets(l);
 }catch{}
}
pullLaunch();
async function saveLaunch(){
 const body={};for(const k of ['server','name','clan','skin','ddnetData'])if($('#s_'+k))body[k]=$('#s_'+k).value.trim();
 if($('#s_skinDownload'))body.skinDownload=$('#s_skinDownload').checked?'on':'off';
 try{const r=await(await fetch('/api/launch',{method:'POST',body:JSON.stringify(body)})).json();
  $('#s_note').textContent=r.reply||'сохранено';if($('#s_gfx'))$('#s_gfx').textContent=r.reply||'сохранено';}catch{$('#s_note').textContent='не сохранилось'}
 pullLaunch();
}
$('#s_save').addEventListener('click',saveLaunch);
if($('#s_save2'))$('#s_save2').addEventListener('click',saveLaunch);
async function pullKnobs(){
 try{const list=await(await fetch('/api/knobs')).json();
  $('#knobs').innerHTML='<tr><th>настройка</th><th>сейчас</th><th>по умолчанию</th></tr>'+
   list.map((k)=>'<tr class="'+(k.changed?'changed':'')+'"><td>'+esc(k.key)+'</td><td><input data-knob="'+esc(k.key)+'" value="'+esc(String(k.value))+'"></td><td class="num" style="color:var(--dim)">'+esc(String(k.def))+'</td></tr>').join('');
  for(const inp of document.querySelectorAll('[data-knob]')){
   inp.addEventListener('change',async()=>{
    const key=inp.dataset.knob;const v=inp.value.trim();
    try{await fetch('/api/knobs',{method:'POST',body:JSON.stringify({key,value:v===''?undefined:v})});}catch{}
    pullKnobs();
   });
  }
 }catch{}
}
$('#tsound').addEventListener('click',()=>{muted=!muted;$('#tsound').className='ghost'+(muted?'':' on');if(!muted)beep(600,70,0.12)});
muted=true;
$('#log').addEventListener('scroll',()=>{const e=$('#log');stick=e.scrollTop+e.clientHeight>=e.scrollHeight-24});
function cell(k,v){return '<div><div class="k">'+k+'</div><div class="v">'+v+'</div></div>'}
function esc(s){return String(s).replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
async function tick(){
 let d;try{d=await(await fetch('/api')).json()}catch{return}
 if(!d||!d.status)return;
 const s=d.status,on=s.phase==='online';lastStatus=s;lastVersion=d.version||'';
 $('#dot').className='dot '+(on?'on':s.phase==='connecting'?'':'off');
 $('#head').textContent=s.name+' — '+(on?s.server:(s.offlineReason||s.phase));
 $('#ver').textContent=d.version?('версия '+d.version.slice(0,7)):'версия неизвестна';
 if($('#footver'))$('#footver').textContent=(d.version?('версия '+d.version.slice(0,7)):'версия неизвестна')+' · '+(s.server||'');
 const st=d.stats||'',get=(k)=>{const m=st.match(new RegExp(k+'=(\\\\S+)'));return m?m[1]:'—'};
 $('#grid').innerHTML=[
  cell('Мозг',get('brain')),cell('Оружие',get('weapon')),cell('Настройка',get('ab')),
  cell('Цель',s.targetName?esc(s.targetName)+(s.targetDist!=null?' · '+s.targetDist+'px':''):'—'),
  cell('Режим',s.acting?s.mode:'стоит'),cell('Во фризе',s.frozen?'да':'нет'),
  cell('Убил',get('kills')),cell('Умер',get('deaths')),cell('Сам /kill',get('selfKills')),
  cell('Клипов',get('clips')),cell('Хаммеров',get('hammerFires')),cell('Хуков',get('hooksFired'))
 ].join('');
 lines=d.lines||[];renderLog();renderChat();watchVotes();
}
function renderLog(){
 const cls={chat:'chat',event:'evt',whisper:'wsp',log:''};
 const keep=(l)=>{
  if(logFilter==='chat'&&l.kind!=='chat')return false;
  if(logFilter==='evt'&&l.kind!=='event')return false;
  if(logFilter==='wsp'&&l.kind!=='whisper')return false;
  if(logFind&&!((l.from||'')+' '+l.text).toLowerCase().includes(logFind))return false;
  return true;
 };
 const rows=lines.filter(keep);
 $('#log').innerHTML=rows.length?rows.map((l)=>'<div class="'+(l.from==='сервер'?'sys':(cls[l.kind]||''))+'">'+(l.from?esc(l.from)+': ':'')+esc(l.text)+'</div>').join('')
  :'<div style="color:var(--dim)">под фильтр ничего не попало</div>';
 if(stick)$('#log').scrollTop=$('#log').scrollHeight;
}
let tab={list:null,i:-1,head:'',word:''};
let cmdNames=[];fetch('/api/commands').then((r)=>r.json()).then((v)=>{cmdNames=v||[]}).catch(()=>{});
const chatField=$('#chatfield');
function openChat(pref){
 chatOpen=true;$('#chatin').hidden=false;$('#chatov').classList.add('open');
 if(pref!==undefined)chatField.value=pref;
 $('#chatprompt').textContent=chatField.value.startsWith('!')?'Команда:':'Все:';
 chatField.focus();renderChat(true);
}
function closeChat(){chatOpen=false;$('#chatin').hidden=true;$('#chatov').classList.remove('open');chatField.value='';$('#chattip').textContent='';chatField.blur();renderChat(true)}
document.addEventListener('keydown',(e)=>{
 const onField=document.activeElement&&document.activeElement.tagName==='INPUT'&&document.activeElement!==chatField;
 if(onField)return;
 if(!chatOpen&&(e.key==='F3'||e.key==='F4')){e.preventDefault();botCmd(e.key==='F3'?'!yes':'!no');return}
 if(!chatOpen&&(e.key==='Enter'||e.key==='t')){e.preventDefault();openChat('')}
 else if(!chatOpen&&e.key==='/'){e.preventDefault();openChat('!')}
 else if(chatOpen&&e.key==='Escape'){e.preventDefault();closeChat()}
});
chatField.addEventListener('input',()=>{
 $('#chatprompt').textContent=chatField.value.startsWith('!')?'Команда:':'Все:';
 $('#chattip').textContent='';
 tab={list:null,i:-1,head:'',word:''};
});
chatField.addEventListener('keydown',async(e)=>{
 if(e.key==='Tab'){
  e.preventDefault();
  const v=chatField.value;
  if(tab.list===null){
   const m=v.match(/(\\S*)$/);const word=m?m[1]:'';
   const isCmd=word.startsWith('!');
   if(!isCmd&&word.length===0){$('#chattip').textContent='наберите начало ника';return}
   const fr=view?view.latest():null;
   const pool=isCmd?cmdNames.map((c)=>'!'+c)
    :(fr?((fr.players&&fr.players.length?fr.players:fr.tees).map((t)=>t.name).filter(Boolean)):[]);
   const low=word.toLowerCase();
   let hits=pool.filter((c)=>c.toLowerCase().startsWith(low));
   if(!hits.length&&!isCmd&&word.length>=2)hits=pool.filter((c)=>c.toLowerCase().includes(low));
   if(!hits.length){$('#chattip').textContent=isCmd?'нет такой команды':'никого с таким ником';return}
   tab={list:hits,i:-1,head:v.slice(0,v.length-word.length),word};
  }
  tab.i=(tab.i+(e.shiftKey?-1:1)+tab.list.length)%tab.list.length;
  chatField.value=tab.head+tab.list[tab.i]+(tab.list.length===1?' ':'');
  $('#chattip').textContent=tab.list.length>1?(tab.i+1)+' из '+tab.list.length+' · Tab дальше':'';
  if(tab.list.length===1)tab={list:null,i:-1,head:'',word:''};
  return;
 }
 if(e.key==='ArrowUp'||e.key==='ArrowDown'){
  if(!hist.length)return;e.preventDefault();
  if(e.key==='ArrowUp')hix=hix<0?hist.length-1:Math.max(0,hix-1);
  else{hix=hix+1;if(hix>=hist.length){hix=-1;chatField.value='';return}}
  chatField.value=hist[hix];return;
 }
 if(e.key!=='Enter')return;
 e.preventDefault();
 const v=chatField.value.trim();
 if(v===''){closeChat();return}
 if(hist[hist.length-1]!==v)hist.push(v);hix=-1;
 chatField.value='';$('#chattip').textContent='';lastCmdAt=Date.now();
 try{await fetch('/cmd',{method:'POST',body:JSON.stringify({line:v})});}catch{}
 await tick();
});
let chatDrawnSeq=-1,chatDrawnOpen=false,lastCmdAt=0,chatIconsMissing=false;
function looksByName(name){
 const fr=view?view.latest():null;if(!fr||!name)return null;
 return (fr.players||[]).find((p)=>p.name===name)||fr.tees.find((t)=>t.name===name)||null;
}
function renderChat(force){
 const now=Date.now();
 for(const l of lines)if(l.seq!==undefined&&!seenAt.has(l.seq))seenAt.set(l.seq,chatSeen<0?now-8000:now);
 if(lines.length)chatSeen=lines[lines.length-1].seq;
 if(seenAt.size>400){const keep=new Set(lines.map((l)=>l.seq));for(const k of seenAt.keys())if(!keep.has(k))seenAt.delete(k)}
 const last=lines.length?lines[lines.length-1].seq:-1;
 const shown=lines.filter((l)=>l.kind==='chat'||l.kind==='whisper'||(l.kind==='log'&&Date.now()-lastCmdAt<10000&&(seenAt.get(l.seq)||0)>=lastCmdAt-500));
 const rows=shown.slice(chatOpen?-14:-9);
 const anyFading=rows.some((l)=>{const a=now-(seenAt.get(l.seq)||0);return a>15000&&a<18000});
 if(!force&&last===chatDrawnSeq&&chatOpen===chatDrawnOpen&&!anyFading&&!chatIconsMissing)return;
 chatDrawnSeq=last;chatDrawnOpen=chatOpen;chatIconsMissing=false;
 const box=$('#chatlines');
 box.innerHTML=rows.map((l)=>{
  const age=now-(seenAt.get(l.seq)||now);
  const op=chatOpen?1:age<16000?1:age<17000?1-(age-16000)/1000:0;
  if(op<=0)return '';
  let cls=l.kind==='whisper'?'wsp':l.kind==='log'?'me':'';
  let text=l.text||'';
  if(l.from==='сервер')return '<div class="sys" style="opacity:'+op.toFixed(2)+'">*** '+esc(text)+'</div>';
  if(l.kind==='chat'&&text.startsWith('(team) ')){cls='team';text=text.slice(7)}
  if(l.kind==='chat'&&text.startsWith('*')){cls='hl';text=text.slice(1)}
  let icon='';
  const who=l.from?looksByName(l.from):null;
  if(who&&view&&view.teeIcon){icon=view.teeIcon(who,32);if(icon===null)chatIconsMissing=true}
  return '<div class="'+cls+'" style="opacity:'+op.toFixed(2)+'">'+(icon?'<img class="tee" alt="" src="'+icon+'">':'')+(l.from?'<b>'+esc(l.from)+'</b>: ':'')+esc(text)+'</div>';
 }).join('');
 try{const top=box.getBoundingClientRect().top;while(box.firstElementChild&&box.firstElementChild.getBoundingClientRect().top<top-0.5)box.removeChild(box.firstElementChild)}catch{}
}

$('#i').addEventListener('keydown',(e)=>{
 if(e.key==='ArrowUp'){if(!hist.length)return;e.preventDefault();hix=hix<0?hist.length-1:Math.max(0,hix-1);$('#i').value=hist[hix];}
 else if(e.key==='ArrowDown'){if(hix<0)return;e.preventDefault();hix=hix+1;if(hix>=hist.length){hix=-1;$('#i').value='';}else $('#i').value=hist[hix];}
});
$('#f').addEventListener('submit',async(e)=>{e.preventDefault();const v=$('#i').value.trim();if(!v)return;
 if(hist[hist.length-1]!==v)hist.push(v);hix=-1;$('#i').value='';
 await fetch('/cmd',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({line:v})});tick()});
tick();setInterval(tick,1000);setInterval(()=>renderChat(false),250);
const cv=$('#cv');
const css=getComputedStyle(document.documentElement);
view=createView(cv,{css:(n)=>css.getPropertyValue(n).trim(),onInfo:(i)=>info(i)});
const zoomToSlider=(z)=>Math.round(100/z);
$('#zoom').addEventListener('input',()=>{view.setZoom(100/Number($('#zoom').value))});
function setFollow(on){view.follow(on);$('#follow').className='ghost'+(on?' on':'')}
$('#follow').addEventListener('click',()=>{view.spectate(-1);$('#spec').value='-1';setFollow(true)});
$('#spec').addEventListener('change',()=>{view.spectate(Number($('#spec').value));setFollow(true)});
$('#whole').addEventListener('click',()=>{if(!view.fit())return;setFollow(false);$('#zoom').value=zoomToSlider(view.zoom())});
$('#tmode').addEventListener('click',()=>{const next={map:'ent',ent:'both',both:'map'}[view.mode()];view.setMode(next);$('#tmode').textContent=modeNames[next];$('#tmode').className='ghost'+(next!=='map'?' on':'')});
for(const [id,key] of [['#troute','route'],['#ttraps','traps'],['#tnames','names'],['#tcursor','cursor'],['#tboard','board']]){
 $(id).addEventListener('click',()=>{const on=view.toggle(key);$(id).className='ghost'+(on?' on':'')});
}
let drag=null,moved=0;
cv.addEventListener('pointerdown',(e)=>{drag={x:e.clientX,y:e.clientY};moved=0;cv.className='drag';try{cv.setPointerCapture(e.pointerId)}catch{}});
cv.addEventListener('pointermove',(e)=>{if(!drag)return;moved+=Math.abs(e.clientX-drag.x)+Math.abs(e.clientY-drag.y);
 if(moved>4){view.pan(e.clientX-drag.x,e.clientY-drag.y);$('#follow').className='ghost'}drag={x:e.clientX,y:e.clientY}});
cv.addEventListener('pointerup',(e)=>{
 if(drag&&moved<=4){const r=cv.getBoundingClientRect();const id=view.pick(e.clientX-r.left,e.clientY-r.top);
  if(id>=0){const fr=view.latest();const self=fr?fr.selfId:-1;view.spectate(id===self?-1:id);$('#spec').value=String(id===self?-1:id);setFollow(true)}}
 drag=null;cv.className=''});
cv.addEventListener('wheel',(e)=>{e.preventDefault();view.zoomBy(e.deltaY<0?1/1.1:1.1);$('#zoom').value=zoomToSlider(view.zoom())},{passive:false});
document.addEventListener('keydown',(e)=>{if(e.key==='Tab'&&!chatOpen){e.preventDefault();if(!boardHeld){boardHeld=true;view.toggle('board',true)}}});
document.addEventListener('keyup',(e)=>{if(e.key==='Tab'&&boardHeld){boardHeld=false;view.toggle('board',$('#tboard').className.includes('on'))}});
let lastInfo=0;
function info(i){
 const now=performance.now();if(now-lastInfo<250)return;lastInfo=now;
 const age=frame?Math.round(now-(frame._at||now)):0;
 if($('#vinfo2'))$('#vinfo2').textContent=(frame?('тик '+frame.tick+' · ти '+frame.tees.length+' · '+(age>1500?'нет данных':'живое')):'нет данных')+' · '+i.fps+' FPS · масштаб '+Math.round(100/i.zoom)+'%';
 if($('#legend'))$('#legend').style.display=i.own?'':'none';
}
async function pullMap(name){
 try{const m=await(await fetch('/api/map')).json();if(!m)return;
  const raw=atob(m.kinds),k=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)k[i]=raw.charCodeAt(i);
  m.k=k;
  if(m.traps){const tr=atob(m.traps),tk=new Uint8Array(tr.length);for(let i=0;i<tr.length;i++)tk[i]=tr.charCodeAt(i);m.t=tk;}
  map=m;mapName=name;view.setLiveMap(m);view.loadScene(name);}catch{}
}
function loadAudio(key,names){
 for(const n of names){
  const a=new Audio('/assets/audio/'+n);
  a.volume=0.9;
  a.addEventListener('canplaythrough',()=>{if(!snd[key])snd[key]=a},{once:true});
 }
}
let dataAsked=false;
function loadAssets(launch){
 if(!launch)return;
 const found=!!launch.ddnetGraphics;
 if(found!==dataFound||!dataAsked){dataAsked=true;dataFound=found;view.loadData(found);if(found&&mapName)view.loadScene(mapName)}
 if(!launch.ddnetData&&!launch.ddnetDataFound)return;
 if(snd.loaded)return;snd.loaded=true;
 loadAudio('hook',['hook_attach-01.wav','hook_attach-02.wav','hook_loop-01.wav']);
 loadAudio('freeze',['player_pain_short-01.wav','hit-01.wav']);
 loadAudio('thaw',['player_spawn-01.wav','pickup_armor-01.wav']);
}
function play(key,freq,ms,vol){
 if(muted)return;
 const a=snd[key];
 if(a&&a.play){try{a.currentTime=0;void a.play();return}catch{}}
 beep(freq,ms,vol);
}
function beep(freq,ms,vol){
 if(muted)return;
 try{ac=ac||new (window.AudioContext||window.webkitAudioContext)();
  const o=ac.createOscillator(),g=ac.createGain();
  o.type='sine';o.frequency.value=freq;g.gain.value=vol;
  o.connect(g);g.connect(ac.destination);o.start();
  g.gain.exponentialRampToValueAtTime(0.0001,ac.currentTime+ms/1000);
  o.stop(ac.currentTime+ms/1000);}catch{}
}
function sounds(old,next){
 if(!old||!next||!old.tees||!next.tees)return;
 const a=old.tees.find((t)=>t.id===old.selfId),b=next.tees.find((t)=>t.id===next.selfId);
 if(!a||!b)return;
 if(!a.frozen&&b.frozen)play('freeze',160,240,0.16);
 if(a.frozen&&!b.frozen)play('thaw',520,110,0.13);
 if(a.hook<5&&b.hook>=5)play('hook',760,70,0.11);
}
let specKey='';
function fillSpec(f){
 const list=(f.players&&f.players.length?f.players:f.tees).filter((p)=>p.id!==f.selfId);
 const key=list.map((p)=>p.id+':'+p.name).join('|');if(key===specKey)return;specKey=key;
 const cur=$('#spec').value;
 $('#spec').innerHTML='<option value="-1">за ботом</option>'+list.map((p)=>'<option value="'+p.id+'">'+esc(p.name||('#'+p.id))+'</option>').join('');
 $('#spec').value=list.some((p)=>String(p.id)===cur)?cur:'-1';
 if($('#spec').value==='-1'&&view.spec()>=0&&!list.some((p)=>p.id===view.spec()))view.spectate(-1);
}
let pulling=false;
async function pullFrame(){
 if(document.hidden||pulling)return;
 pulling=true;
 try{const f=await(await fetch('/api/live')).json();
  if(f&&f.tees){
   f._at=performance.now();
   prevFrame=frame;sounds(frame,f);frame=f;view.pushFrame(f);fillSpec(f);
   if(f.map&&f.map!==mapName)await pullMap(f.map);
   if(f.doing)$('#doing').textContent='сейчас: '+f.doing;
  }
 }catch{}
 pulling=false;
}
function loop(){try{view.draw()}catch(err){console.error(err)}requestAnimationFrame(loop)}
setInterval(pullFrame,40);pullFrame();requestAnimationFrame(loop);
</script></body></html>`;
