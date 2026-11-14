import { closeSync, constants, fstatSync, fsyncSync, mkdirSync, openSync, readdirSync, readSync, renameSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import { threadId } from "node:worker_threads";
import type { Collision } from "../core/collision.ts";
import type { CourseSource, MapSolution } from "../plan/goresMap.ts";
import { FLOAT_OFF_WHY, PACK_MAX_BYTES, PACK_VERSION, parsePack, verifyPack } from "../plan/goresPack.ts";

export const ROUTE_PACK_URL = "https://raw.githubusercontent.com/Wranked1/DDNet-AI/routes/gores/";
export const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT = "ddnet-ai-routes";
const KEY_RE = /^[0-9a-f]{32}$/;

export type PackFetchFn = (url: string, cap: number, timeoutMs: number) => Promise<Uint8Array | null>;

export type PackMiss = "absent" | "error";

export function packName(key: string): string | null {
  return typeof key === "string" && KEY_RE.test(key) ? `${key}.v${PACK_VERSION}.grp` : null;
}

export function packFile(dir: string, key: string): string | null {
  const name = packName(key);
  return name === null ? null : join(dir, name);
}

export function loadCachedPack(dir: string, key: string): Uint8Array | null {
  const file = packFile(dir, key);
  if (file === null) return null;
  try {

    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const st = fstatSync(fd);
      if (!st.isFile() || st.size > PACK_MAX_BYTES) return null;

      const buf = new Uint8Array(Math.min(PACK_MAX_BYTES, st.size) + 1);
      let got = 0;
      while (got < buf.length) {
        const n = readSync(fd, buf, got, buf.length - got, null);
        if (n === 0) break;
        got += n;
      }
      return got > st.size || got > PACK_MAX_BYTES ? null : buf.slice(0, got);
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

export const packTmpFile = (file: string): string => `${file}.${process.pid}.${threadId}.tmp`;

export function savePack(dir: string, key: string, bytes: Uint8Array): boolean {
  const file = packFile(dir, key);
  if (file === null || bytes.length === 0 || bytes.length > PACK_MAX_BYTES) return false;
  const tmp = packTmpFile(file);
  try {
    mkdirSync(dir, { recursive: true });

    rmSync(tmp, { force: true });
    const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      let at = 0;
      while (at < bytes.length) at += writeSync(fd, bytes, at, bytes.length - at);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, file);
    dropOtherVersions(dir, key);
    return true;
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {}
    return false;
  }
}

function dropOtherVersions(dir: string, key: string): void {
  const mine = packName(key);
  if (mine === null) return;
  try {
    for (const name of readdirSync(dir)) {
      if (name !== mine && name.startsWith(`${key}.v`) && /^[0-9a-f]{32}\.v\d+\.grp$/.test(name)) rmSync(join(dir, name), { force: true });
    }
  } catch {

  }
}

async function httpsGet(url: string, cap: number, timeoutMs: number): Promise<Uint8Array | null> {
  if (!url.startsWith("https://")) return null;
  const res = await fetch(url, {
    method: "GET",

    redirect: "manual",
    credentials: "omit",
    headers: { "user-agent": USER_AGENT, accept: "application/octet-stream" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status !== 200 || res.body === null) {
    await res.body?.cancel().catch(() => {});

    if (res.status === 404 || res.status === 410 || (res.status >= 300 && res.status < 400) || (res.status === 200 && res.body === null)) return null;
    throw new Error(`the server answered ${res.status}`);
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (got > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export async function fetchPack(key: string, opts: { fetchFn?: PackFetchFn; timeoutMs?: number } = {}): Promise<Uint8Array | PackMiss> {
  const name = packName(key);
  if (name === null) return "absent";
  try {
    const fetchFn = opts.fetchFn ?? httpsGet;
    const bytes = await fetchFn(`${ROUTE_PACK_URL}${name}`, PACK_MAX_BYTES, opts.timeoutMs ?? FETCH_TIMEOUT_MS);

    if (bytes === null || !(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > PACK_MAX_BYTES) return "absent";
    return bytes;
  } catch {
    return "error";
  }
}

export async function getPack(
  col: Collision,
  key: string,
  dir: string,
  opts: { offline?: boolean; source?: CourseSource | null; fetchFn?: PackFetchFn } = {},
): Promise<{ sol: MapSolution; from: "cache" | "net" } | PackMiss> {
  const file = packFile(dir, key);
  if (file === null) return "absent";
  try {
    const cached = loadCachedPack(dir, key);
    if (cached !== null) {
      const parsed = parsePack(cached, key);
      const checked = parsed.ok ? verifyPack(col, parsed.sol, opts.source) : null;
      if (checked !== null && checked.ok) return { sol: checked.sol, from: "cache" };

      if (checked !== null && !checked.ok && checked.why === FLOAT_OFF_WHY) return "error";
      try {
        rmSync(file, { force: true });
      } catch {}
    }
    if (opts.offline === true) return "absent";
    const bytes = await fetchPack(key, { fetchFn: opts.fetchFn });
    if (typeof bytes === "string") return bytes;
    const parsed = parsePack(bytes, key);
    if (!parsed.ok) return "absent";
    const checked = verifyPack(col, parsed.sol, opts.source);
    if (!checked.ok) return checked.why === FLOAT_OFF_WHY ? "error" : "absent";
    savePack(dir, key, bytes);
    return { sol: checked.sol, from: "net" };
  } catch {
    return "error";
  }
}
