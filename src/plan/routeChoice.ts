import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Collision } from "../core/collision.ts";
import { TILE_TELECHECKIN, TILE_TELECHECKINEVIL, TILE_TELEIN, TILE_TELEINEVIL, TUNING } from "../core/tuning.ts";

export const MIN_GAIN_TICKS = 15;

export const MAX_STEP_MS = 2000;

type Tile = { tx: number; ty: number };

export type LagSummary = {
  lag: number;
  scripted: { j0: number; arrived: number; walks: number; median: number };
  walker: { j0: number; arrived: number; walks: number; median: number; maxStepMs: number };
};

export type ChoiceEntry = { spawn: [number, number]; spot: [number, number]; side: string; use: boolean; lags: LagSummary[] };

export type ChoiceMap = { name: string; grid: string; veto?: string; entries: ChoiceEntry[]; region?: Region };
export type ChoiceTable = { version: number; params?: { jitter: number; walks: number; lags: number[]; rule: ChoiceRule }; maps: Record<string, ChoiceMap> };

export const CHOICE_VERSION = 1;

export const norm = (name: string): string => name.trim().toLowerCase();

const hashes = new WeakMap<Collision, { revision: number; hash: string }>();
export function gridHash(col: Collision): string {
  const known = hashes.get(col);
  if (known !== undefined && known.revision === col.revision) return known.hash;
  const h = createHash("sha256");
  h.update(`${col.width}x${col.height}${col.noWeakHook ? "n" : ""}`);
  for (const layer of [col.tiles, col.tileFlags, col.frontIndex, col.frontFlags, col.teleType, col.teleNumber]) {
    if (layer === undefined) h.update("-");
    else h.update(layer);
  }
  const hash = h.digest("hex").slice(0, 16);
  hashes.set(col, { revision: col.revision, hash });
  return hash;
}

export const choiceKey = (name: string, col: Collision): string => `${norm(name)}|${gridHash(col)}`;

export const REGION_MARGIN = Math.ceil(TUNING.hookLength / 32) + 3;

export type Box = { x0: number; y0: number; x1: number; y1: number };

export type Region = Box & { hash: string };

const REGION_HASH = /^[0-9a-f]{16}$/;
export function validRegion(r: unknown): r is Region {
  if (typeof r !== "object" || r === null) return false;
  const o = r as Record<string, unknown>;
  return ["x0", "y0", "x1", "y1"].every((k) => Number.isInteger(o[k])) && typeof o.hash === "string" && REGION_HASH.test(o.hash) && (o.x0 as number) <= (o.x1 as number) && (o.y0 as number) <= (o.y1 as number);
}

export function unionBox(a: Box, b: Box): Box {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

function computeRegionHash(col: Collision, box: Box): string {
  if (box.x0 < 0 || box.y0 < 0 || box.x0 > box.x1 || box.y0 > box.y1 || box.x0 >= col.width || box.y0 >= col.height) return "";
  const x1 = Math.min(box.x1, col.width - 1);
  const y1 = Math.min(box.y1, col.height - 1);
  const h = createHash("sha256");
  h.update(`${box.x0},${box.y0},${box.x1},${box.y1}${col.noWeakHook ? "n" : ""}${box.x1 >= col.width - 1 ? ` w${col.width}` : ""}${box.y1 >= col.height - 1 ? ` h${col.height}` : ""}`);
  const speedup = col.snapshot().speedup;
  for (const layer of [col.tiles, col.tileFlags, col.frontIndex, col.frontFlags, col.teleType, col.teleNumber, speedup?.force, speedup?.maxSpeed, speedup?.angle]) {
    if (layer === undefined) h.update("-");
    else for (let y = box.y0; y <= y1; y++) h.update(layer.subarray(y * col.width + box.x0, y * col.width + x1 + 1));
  }
  const type = col.teleType;
  const num = col.teleNumber;
  if (type !== undefined && num !== undefined) {
    const entered = new Set<number>();
    let checkpoint = false;
    for (let y = box.y0; y <= y1; y++) {
      for (let x = box.x0; x <= x1; x++) {
        const i = y * col.width + x;
        if ((type[i] === TILE_TELEIN || type[i] === TILE_TELEINEVIL) && num[i] !== 0) entered.add(num[i]);
        else if (type[i] === TILE_TELECHECKIN || type[i] === TILE_TELECHECKINEVIL) checkpoint = true;
      }
    }
    const tiles = (outs: readonly { x: number; y: number }[]): string => outs.map((o) => `${Math.trunc(o.x / 32)},${Math.trunc(o.y / 32)}`).join(";");
    for (const n of [...entered].sort((a, b) => a - b)) h.update(` t${n}:${tiles(col.teleOutsFor(n))}`);
    if (checkpoint) {
      for (let k = 1; k <= 255; k++) {
        const outs = col.teleCheckOutsFor(k);
        if (outs.length > 0) h.update(` c${k}:${tiles(outs)}`);
      }
    }
  }
  return h.digest("hex").slice(0, 16);
}

const regionHashes = new WeakMap<Collision, { revision: number; hashes: Map<string, string> }>();
export function regionHash(col: Collision, box: Box): string {
  let known = regionHashes.get(col);
  if (known === undefined || known.revision !== col.revision) regionHashes.set(col, (known = { revision: col.revision, hashes: new Map() }));
  const id = `${box.x0},${box.y0},${box.x1},${box.y1}`;
  let hash = known.hashes.get(id);
  if (hash === undefined) known.hashes.set(id, (hash = computeRegionHash(col, box)));
  return hash;
}

export function regionBox(col: Collision, bounds: Box, margin = REGION_MARGIN): Box {
  const clip = (b: Box): Box => ({ x0: Math.max(0, b.x0 - margin), y0: Math.max(0, b.y0 - margin), x1: Math.min(col.width - 1, b.x1 + margin), y1: Math.min(col.height - 1, b.y1 + margin) });
  let box = clip(bounds);
  for (let round = 0; round < 4 && col.teleType !== undefined && col.teleNumber !== undefined; round++) {
    let grown: Box = box;
    for (let y = box.y0; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) {
        const i = y * col.width + x;
        const type = col.teleType[i];
        if ((type !== TILE_TELEIN && type !== TILE_TELEINEVIL) || col.teleNumber[i] === 0) continue;
        for (const out of col.teleOutsFor(col.teleNumber[i])) {
          const tx = Math.trunc(out.x / 32);
          const ty = Math.trunc(out.y / 32);
          grown = unionBox(grown, clip({ x0: tx, y0: ty, x1: tx, y1: ty }));
        }
      }
    }
    if (grown.x0 === box.x0 && grown.y0 === box.y0 && grown.x1 === box.x1 && grown.y1 === box.y1) break;
    box = grown;
  }
  return box;
}

export const regionOf = (col: Collision, box: Box): Region => ({ x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1, hash: regionHash(col, box) });

export function matchMapKey(maps: Record<string, { name: string; region?: Region }>, name: string, col: Collision): string | undefined {
  const exact = choiceKey(name, col);
  if (maps[exact] !== undefined) return exact;
  const want = norm(name);
  for (const [key, m] of Object.entries(maps)) {
    if (typeof m !== "object" || m === null || typeof m.name !== "string" || norm(m.name) !== want || !validRegion(m.region)) continue;
    if (regionHash(col, m.region) === m.region.hash) return key;
  }
  return undefined;
}

export function choiceRegion(col: Collision, map: ChoiceMap, library?: Box): Region | undefined {
  let bounds: Box | null = null;
  for (const e of map.entries) {
    for (const [tx, ty] of [e.spawn, e.spot]) {
      const b = { x0: tx, y0: ty, x1: tx, y1: ty };
      bounds = bounds === null ? b : unionBox(bounds, b);
    }
  }
  if (bounds === null && library === undefined) return undefined;
  const box = bounds === null ? (library as Box) : library === undefined ? regionBox(col, bounds) : unionBox(regionBox(col, bounds), library);
  return regionOf(col, box);
}

let loaded: ChoiceTable | null | undefined;

export function shippedChoice(): ChoiceTable | null {
  if (loaded !== undefined) return loaded;
  try {
    const t = JSON.parse(readFileSync(process.env.PATHFIND_TABLE ?? new URL("./routeChoice.json", import.meta.url), "utf8")) as ChoiceTable;
    loaded = t.version === CHOICE_VERSION && typeof t.maps === "object" && t.maps !== null ? t : null;
  } catch {
    loaded = null;
  }
  return loaded;
}

export function walkerVeto(mapName: string, col: Collision, table: ChoiceTable | null = shippedChoice()): string | null {
  if (process.env.PATHFIND_VETO === "0" || table === null) return null;
  const key = matchMapKey(table.maps, mapName, col);
  return (key === undefined ? undefined : table.maps[key].veto) ?? null;
}

export function walkerChosen(mapName: string, col: Collision, spawn: Tile, goal: Tile, table: ChoiceTable | null = shippedChoice()): boolean {
  if (table === null) return false;
  const key = matchMapKey(table.maps, mapName, col);
  const map = key === undefined ? undefined : table.maps[key];
  if (map === undefined) return false;
  for (const e of map.entries) if (e.use && e.spawn[0] === spawn.tx && e.spawn[1] === spawn.ty && e.spot[0] === goal.tx && e.spot[1] === goal.ty) return true;
  return false;
}

export type ChoiceRule = { minGain: number; maxMisses: number; maxStepMs: number };
export const DEFAULT_RULE: ChoiceRule = { minGain: MIN_GAIN_TICKS, maxMisses: 0, maxStepMs: MAX_STEP_MS };

export function walkerWins(lags: readonly LagSummary[], rule: ChoiceRule = DEFAULT_RULE): boolean {
  if (lags.length === 0) return false;
  for (const m of lags) {
    const w = m.walker;
    if (w.walks === 0 || w.j0 <= 0 || w.walks - w.arrived > rule.maxMisses || w.maxStepMs > rule.maxStepMs) return false;
    if (m.scripted.j0 > 0 && w.j0 > m.scripted.j0) return false;
    if (m.scripted.median > 0 && m.scripted.median - w.median < rule.minGain) return false;
  }
  return true;
}
