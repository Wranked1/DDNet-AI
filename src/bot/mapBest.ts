import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { writeJsonAtomic } from "./atomicWrite.ts";

export const AB_FILE_NAME = "ab.json";
export const AB_VERSION = 2;

export const UNKNOWN_MAP = "?";

export const DEFAULT_ARM = "off";

export const MAPBEST_Z = 3.29;
export const MAPBEST_MIN_FREEZES = 100;

export const AB_SAVE_EVERY = 10;

export const AB_KEEP_ROWS = 2000;

export type AbRow = { map: string; sig: string; arm: string; blocks: number; blockedBy: number; at: string };

export type AbStore = { rows: AbRow[]; legacy?: Record<string, unknown>; damaged: boolean; unreadable?: boolean };

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

function isRow(v: unknown): v is AbRow {
  if (!isObject(v)) return false;
  return typeof v.map === "string" && typeof v.sig === "string" && typeof v.arm === "string" && typeof v.at === "string" && Number.isFinite(v.blocks) && Number.isFinite(v.blockedBy);
}

export function readAbFile(file: string): AbStore {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return { rows: [], damaged: false };
    return { rows: [], damaged: false, unreadable: true };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return { rows: [], damaged: true };
  }
  if (!isObject(raw)) return { rows: [], damaged: true };
  if (raw.version === undefined && Array.isArray(raw.arms)) return { rows: [], legacy: raw, damaged: false };
  if (raw.version !== AB_VERSION || !Array.isArray(raw.rows)) return { rows: [], damaged: true };
  const rows = raw.rows.filter(isRow).map((r) => ({ map: r.map, sig: r.sig, arm: r.arm, blocks: count(r.blocks), blockedBy: count(r.blockedBy), at: r.at }));
  return { rows, legacy: isObject(raw.legacy) ? raw.legacy : undefined, damaged: false };
}

export function legacyRows(legacy: Record<string, unknown> | undefined): AbRow[] {
  const arms = legacy !== undefined && Array.isArray(legacy.arms) ? legacy.arms : [];
  return arms.filter((a): a is Record<string, unknown> => isObject(a) && typeof a.name === "string").map((a) => ({ map: UNKNOWN_MAP, sig: "legacy", arm: a.name as string, blocks: count(a.enemyFreezes), blockedBy: count(a.selfFreezes), at: "" }));
}

export function allRows(store: AbStore): AbRow[] {
  return [...store.rows, ...legacyRows(store.legacy)];
}

export function writeAbFile(file: string, store: AbStore): boolean {
  if (store.unreadable === true) return false;
  try {
    mkdirSync(dirname(file), { recursive: true });
    if (store.damaged) {
      if (existsSync(file)) renameSync(file, `${file}.bad-${Date.now()}`);
      store.damaged = false;
    }
    const body: Record<string, unknown> = { version: AB_VERSION, rows: store.rows };
    if (store.legacy !== undefined) body.legacy = store.legacy;
    writeJsonAtomic(file, JSON.stringify(body, null, 1));
    return true;
  } catch {
    return false;
  }
}

export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : stableJson(x))).join(",")}]`;
  if (isObject(v)) {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

export function abSig(plannerCfg: Record<string, unknown>, lowCpu: boolean, strong: boolean): string {
  return createHash("sha1").update(stableJson({ plan: plannerCfg, lowCpu, strong })).digest("hex").slice(0, 12);
}

export class AbTally {
  store: AbStore;

  unsaved = 0;

  constructor(store: AbStore) {
    this.store = store;
  }

  static load(file: string): AbTally {
    return new AbTally(readAbFile(file));
  }

  rows(): AbRow[] {
    return allRows(this.store);
  }

  note(map: string, sig: string, arm: string, won: boolean, now: Date = new Date()): void {
    const rows = this.store.rows;
    let row = rows.find((r) => r.map === map && r.sig === sig);
    if (row === undefined) {
      row = { map, sig, arm, blocks: 0, blockedBy: 0, at: "" };
      rows.push(row);
    }
    if (won) row.blocks++;
    else row.blockedBy++;
    row.at = now.toISOString();
    this.unsaved++;
    while (rows.length > AB_KEEP_ROWS) {
      let oldest = 0;
      for (let i = 1; i < rows.length; i++) if (rows[i].at < rows[oldest].at) oldest = i;
      rows.splice(oldest, 1);
    }
  }

  save(file: string): boolean {
    if (this.store.unreadable === true) {
      const disk = readAbFile(file);
      if (disk.unreadable === true) return false;
      for (const mine of this.store.rows) {
        const row = disk.rows.find((r) => r.map === mine.map && r.sig === mine.sig);
        if (row === undefined) disk.rows.push({ ...mine });
        else {
          row.blocks += mine.blocks;
          row.blockedBy += mine.blockedBy;
          if (mine.at > row.at) row.at = mine.at;
        }
      }
      this.store = disk;
    }
    if (!writeAbFile(file, this.store)) return false;
    this.unsaved = 0;
    return true;
  }
}

export function wilson(k: number, n: number, z: number): { lo: number; hi: number } {
  if (n <= 0) return { lo: 0, hi: 1 };
  const p = k / n;
  const z2 = z * z;
  const d = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / d;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

export type ArmStat = { arm: string; blocks: number; blockedBy: number; n: number; share: number; lo: number; hi: number };

export type MapBestVerdict =
  | { kind: "pick"; best: ArmStat; def: ArmStat }
  | { kind: "nodata" }
  | { kind: "few"; best: ArmStat | null; def: ArmStat }
  | { kind: "close"; best: ArmStat; def: ArmStat };

function statOf(arm: string, rows: readonly AbRow[], z: number): ArmStat {
  let blocks = 0;
  let blockedBy = 0;
  for (const r of rows) {
    blocks += r.blocks;
    blockedBy += r.blockedBy;
  }
  const n = blocks + blockedBy;
  const { lo, hi } = wilson(blocks, n, z);
  return { arm, blocks, blockedBy, n, share: n > 0 ? blocks / n : 0, lo, hi };
}

export function judgeMapBest(rows: readonly AbRow[], map: string, defSig: string, arms: readonly { arm: string; sig: string }[], z: number = MAPBEST_Z, min: number = MAPBEST_MIN_FREEZES): MapBestVerdict {
  const here = rows.filter((r) => r.map === map);
  const def = statOf(DEFAULT_ARM, here.filter((r) => r.sig === defSig), z);
  const cands = arms.filter((a) => a.sig !== defSig).map((a) => statOf(a.arm, here.filter((r) => r.sig === a.sig), z)).filter((s) => s.n > 0);
  if (def.n === 0 && cands.length === 0) return { kind: "nodata" };
  const ready = cands.filter((s) => s.n >= min);
  if (def.n < min || ready.length === 0) {
    const most = [...cands].sort((a, b) => b.n - a.n || (a.arm < b.arm ? -1 : 1))[0] ?? null;
    return { kind: "few", best: most, def };
  }
  const byLo = [...ready].sort((a, b) => b.lo - a.lo || (a.arm < b.arm ? -1 : 1));
  const best = byLo[0];
  return best.lo > def.hi ? { kind: "pick", best, def } : { kind: "close", best, def };
}
