import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isIPv6 } from "node:net";
import { dirname } from "node:path";
import { writeJsonAtomic } from "./atomicWrite.ts";
import { canonIp, mappedV4 } from "./ipv6.ts";

export const MASTERS = [
  "https://master1.ddnet.org/ddnet/15/servers.json",
  "https://master2.ddnet.org/ddnet/15/servers.json",
  "https://master3.ddnet.org/ddnet/15/servers.json",
  "https://master4.ddnet.org/ddnet/15/servers.json",
];

export type ServerRow = {
  address: string;
  name: string;
  map: string;
  gameType: string;
  location: string;
  passworded: boolean;

  players: number;
  clients: number;
  maxClients: number;
};

export function isAuto(server: unknown): boolean {
  return typeof server === "string" && /^(auto|авто)?$/i.test(server.trim());
}

const ADDR_RE = /^(tw-0\.6\+udp|tw-0\.7\+udp|ddnet\+udp|udp):\/\/(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/;

const ADDR6_RE = /^(tw-0\.6\+udp|tw-0\.7\+udp|ddnet\+udp|udp):\/\/\[([0-9A-Fa-f:.]+)\]:(\d{1,5})$/;

export function pickAddress(addresses: unknown): string | null {
  if (!Array.isArray(addresses)) return null;
  let fallback: string | null = null;
  let v6: string | null = null;
  let v6Six = false;
  for (const a of addresses) {
    if (typeof a !== "string") continue;
    const m = ADDR_RE.exec(a.trim());
    if (m === null) {
      const m6 = ADDR6_RE.exec(a.trim());
      if (m6 === null || v6Six || !isIPv6(m6[2]) || mappedV4(m6[2]) !== null) continue;
      const port6 = Number(m6[3]);
      if (port6 < 1 || port6 > 65535) continue;
      if (v6 === null || m6[1] === "tw-0.6+udp") {
        v6 = `[${canonIp(m6[2])}]:${port6}`;
        v6Six = m6[1] === "tw-0.6+udp";
      }
      continue;
    }
    const port = Number(m[3]);
    if (m[2].split(".").some((o) => Number(o) > 255) || port < 1 || port > 65535) continue;
    const addr = `${m[2]}:${port}`;
    if (m[1] === "tw-0.6+udp") return addr;
    fallback ??= addr;
  }
  return fallback ?? v6;
}

export function isIpv6Row(r: { address: string }): boolean {
  return r.address.startsWith("[");
}

const str = (v: unknown, max = 128): string => (typeof v === "string" ? v.slice(0, max) : "");

export function parseMaster(json: unknown): ServerRow[] {
  const list = json !== null && typeof json === "object" && Array.isArray((json as { servers?: unknown }).servers) ? (json as { servers: unknown[] }).servers : [];
  const seen = new Set<string>();
  const rows: ServerRow[] = [];
  for (const s of list) {
    if (s === null || typeof s !== "object") continue;
    const e = s as { addresses?: unknown; location?: unknown; info?: Record<string, unknown> };
    const address = pickAddress(e.addresses);
    if (address === null || seen.has(address)) continue;
    seen.add(address);
    const info = e.info !== null && typeof e.info === "object" ? e.info : {};
    const clients = Array.isArray(info.clients) ? (info.clients as unknown[]).filter((c): c is Record<string, unknown> => c !== null && typeof c === "object") : [];
    const map = info.map !== null && typeof info.map === "object" ? (info.map as { name?: unknown }).name : info.map;
    rows.push({
      address,
      name: str(info.name) || address,
      map: str(map, 64),
      gameType: str(info.game_type, 32),
      location: str(e.location, 16),
      passworded: info.passworded === true,
      players: clients.filter((c) => c.is_player !== false).length,
      clients: clients.length,
      maxClients: typeof info.max_clients === "number" && Number.isFinite(info.max_clients) ? info.max_clients : 0,
    });
  }
  return rows;
}

const BLOCK_RE = /block|blmap|copy (love|the) box|love box/i;

export function isBlock(r: ServerRow): boolean {
  return BLOCK_RE.test(r.name) || BLOCK_RE.test(r.map) || BLOCK_RE.test(r.gameType);
}

export function pickBlockServer(rows: ServerRow[], opts: { avoid?: string | Iterable<string>; lang?: string } = {}): ServerRow | null {
  const avoid = new Set(typeof opts.avoid === "string" ? [opts.avoid] : (opts.avoid ?? []));
  let best: ServerRow | null = null;
  let bestScore = -Infinity;
  for (const r of rows) {
    if (isIpv6Row(r) || !isBlock(r) || r.passworded || avoid.has(r.address)) continue;
    if (r.maxClients > 0 && r.clients >= r.maxClients - 1) continue;
    if (r.players < 2) continue;
    const score = r.players + (opts.lang === "ru" && /:ru$/i.test(r.location) ? 6 : 0);
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

export const MASTER_CACHE_MAX_AGE_MS = 24 * 3600_000;

const ADDR_PLAIN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}):(\d{1,5})$/;
function plainAddress(a: string): boolean {
  const m = ADDR_PLAIN.exec(a);
  return m !== null && [m[1], m[2], m[3], m[4]].every((o) => Number(o) <= 255) && Number(m[5]) >= 1 && Number(m[5]) <= 65535;
}

const MASTER_CACHE_MAX_ROWS = 10_000;

export function saveMasterCache(file: string, rows: ServerRow[], now = Date.now()): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeJsonAtomic(file, JSON.stringify({ savedAt: now, servers: rows }));
  } catch {

  }
}

export function loadMasterCache(file: string, now = Date.now(), maxAgeMs = MASTER_CACHE_MAX_AGE_MS): { rows: ServerRow[]; ageMs: number } | null {
  try {
    const all = JSON.parse(readFileSync(file, "utf8")) as { savedAt?: unknown; servers?: unknown };
    if (typeof all.savedAt !== "number" || !Array.isArray(all.servers)) return null;
    const ageMs = now - all.savedAt;
    if (!(ageMs >= 0 && ageMs <= maxAgeMs)) return null;
    const rows = all.servers.slice(0, MASTER_CACHE_MAX_ROWS).filter(
      (r): r is ServerRow =>
        r !== null && typeof r === "object" && typeof (r as ServerRow).address === "string" && plainAddress((r as ServerRow).address) && typeof (r as ServerRow).name === "string" && typeof (r as ServerRow).map === "string" && typeof (r as ServerRow).gameType === "string" && typeof (r as ServerRow).location === "string" && typeof (r as ServerRow).passworded === "boolean" && Number.isFinite((r as ServerRow).players) && Number.isFinite((r as ServerRow).clients) && Number.isFinite((r as ServerRow).maxClients),
    );
    return rows.length > 0 ? { rows, ageMs } : null;
  } catch {
    return null;
  }
}

export async function fetchMaster(fetchImpl: typeof fetch = fetch, cacheFile?: string, now = Date.now()): Promise<ServerRow[]> {
  let last: unknown = null;
  for (const url of MASTERS) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000), headers: { "user-agent": "ddnet-ai" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = parseMaster(await res.json());
      if (rows.length > 0) {
        if (cacheFile !== undefined) saveMasterCache(cacheFile, rows, now);
        return rows;
      }
      last = new Error("empty list");
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export async function fetchMasterOrCache(cacheFile: string, opts: { fetchImpl?: typeof fetch; now?: number; onCache?: (ageMs: number) => void } = {}): Promise<ServerRow[]> {
  try {
    return await fetchMaster(opts.fetchImpl, cacheFile, opts.now);
  } catch (err) {
    const cached = loadMasterCache(cacheFile, opts.now);
    if (cached === null) throw err;
    opts.onCache?.(cached.ageMs);
    return cached.rows;
  }
}

export const OFFLINE_SWITCH_MS = 120_000;
export function offlineVerdict(offlineMs: number, masterReachable: boolean): "wait" | "stay" | "switch" {
  if (offlineMs < OFFLINE_SWITCH_MS) return "wait";
  return masterReachable ? "switch" : "stay";
}

export function readAvoid(file: string, now = Date.now()): string[] {
  try {
    const all = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    return Object.entries(all)
      .filter(([, until]) => typeof until === "number" && until > now)
      .map(([addr]) => addr);
  } catch {
    return [];
  }
}

export function addAvoid(file: string, address: string, forMs: number, now = Date.now()): void {
  let all: Record<string, number> = {};
  try {
    all = JSON.parse(readFileSync(file, "utf8")) as Record<string, number>;
  } catch {
    all = {};
  }
  for (const [k, v] of Object.entries(all)) if (typeof v !== "number" || v <= now) delete all[k];
  all[address] = now + forMs;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(all));
}
