import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PlayerInput } from "../core/types.ts";
import { emptyInput } from "../core/types.ts";
import { FLAT_FREEZE_LEFT, FLAT_HOOK_STATE, FLAT_JUMPED, FLAT_POS_X, FLAT_POS_Y, FLAT_VEL_X, FLAT_VEL_Y } from "../core/world.ts";
import type { Collision } from "../core/collision.ts";
import { choiceKey, matchMapKey, norm, regionBox, regionHash, regionOf, unionBox, validRegion } from "./routeChoice.ts";
import type { Box, Region } from "./routeChoice.ts";

export const LIBRARY_VERSION = 3;

export type EncodedTape = number[];

export type LibraryEntry = number[];
const HEAD = 9;
export const TRAJ_EVERY = 4;
const TRAJ_WIDTH = 5;

export type LibraryFile = {
  version: number;

  maps: Record<string, { name: string; goals: Record<string, Record<string, LibraryEntry[]>>; region?: Region }>;

  auto?: Record<string, AutoState>;
};

export type AutoArm = { walks: number; arrived: number; kills: number; freezes: number; median: number; mean?: number };

export type AutoVerdict = { use: boolean; why: string; walker: AutoArm; swing: AutoArm };

export type AutoJob = { built?: boolean; verdict?: AutoVerdict };

export type AutoState = { name: string; spec: string; jobs: Record<string, AutoJob>; failed?: string; fails?: number };

export const MAX_DIST = 28;
export const ASK = 4;

export const SAME_DIST = 4;

export const PER_TILE = 300;

export const ABS_AIM = 1_000_000;

export function resolveAim(input: PlayerInput, x: number, y: number): PlayerInput {
  if (input.targetX < ABS_AIM / 2) return input;
  return { ...input, targetX: Math.round(input.targetX - ABS_AIM - x), targetY: Math.round(input.targetY - ABS_AIM - y) };
}

export function encodeTape(tape: readonly PlayerInput[]): EncodedTape {
  const out: number[] = [];
  let i = 0;
  while (i < tape.length) {
    const a = tape[i];
    let n = 1;
    while (i + n < tape.length) {
      const b = tape[i + n];
      if (b.direction !== a.direction || b.targetX !== a.targetX || b.targetY !== a.targetY || b.jump !== a.jump || b.hook !== a.hook || b.fire !== a.fire) break;
      n++;
    }
    out.push(a.direction, a.targetX, a.targetY, a.jump, a.hook, n);
    i += n;
  }
  return out;
}

export function decodeTape(enc: readonly number[], from = 0): PlayerInput[] {
  const out: PlayerInput[] = [];
  for (let i = from; i + 5 < enc.length; i += 6) {
    for (let k = 0; k < enc[i + 5]; k++) {
      const p = emptyInput();
      p.direction = enc[i];
      p.targetX = enc[i + 1];
      p.targetY = enc[i + 2];
      p.jump = enc[i + 3];
      p.hook = enc[i + 4];
      out.push(p);
    }
  }
  return out;
}

const tileOf = (px: number): number => Math.trunc(px / 32);

function headOf(st: Float64Array, off: number): number[] {
  return [
    Math.round(st[off + FLAT_POS_X]),
    Math.round(st[off + FLAT_POS_Y]),
    Math.round(st[off + FLAT_VEL_X] * 10),
    Math.round(st[off + FLAT_VEL_Y] * 10),
    st[off + FLAT_HOOK_STATE],
    st[off + FLAT_JUMPED],
    st[off + FLAT_FREEZE_LEFT] > 0 ? 1 : 0,
  ];
}

export type Candidate = { tape: PlayerInput[]; misses: number; from: { x: number; y: number }; tick: number; d: number };

function dist(a: readonly number[], h: readonly number[]): number {

  if (Math.max(a[4], 0) !== Math.max(h[4], 0) || a[5] !== h[5] || a[6] !== h[6]) return Infinity;
  return Math.abs(a[0] - h[0]) + Math.abs(a[1] - h[1]) + 0.6 * (Math.abs(a[2] - h[2]) + Math.abs(a[3] - h[3]));
}

type Item = { h: number[]; e: LibraryEntry; k: number };

function itemsOf(e: LibraryEntry): Item[] {
  const out: Item[] = [{ h: e.slice(0, 7), e, k: 0 }];
  const trajAt = HEAD + e[8];
  for (let i = trajAt, k = TRAJ_EVERY; i + TRAJ_WIDTH <= e.length; i += TRAJ_WIDTH, k += TRAJ_EVERY) {
    const kind = e[i + 4];
    out.push({ h: [e[i], e[i + 1], e[i + 2], e[i + 3], (kind & 7) - 1, (kind >> 3) & 7, kind >> 6], e, k });
  }
  return out;
}

export function libraryEntry(st: Float64Array, off: number, tape: readonly PlayerInput[], misses = 0, trajectory: readonly number[] = []): LibraryEntry {
  const enc = encodeTape(tape);
  return [...headOf(st, off), misses, enc.length, ...enc, ...trajectory];
}

export function trajectoryNumbers(st: Float64Array, off: number): number[] {
  const h = headOf(st, off);
  return [h[0], h[1], h[2], h[3], h[4] + 1 + h[5] * 8 + h[6] * 64];
}

export class SegmentLibrary {

  secondary: SegmentLibrary | null = null;

  fast: SegmentLibrary | null = null;
  private readonly tiles: Map<string, LibraryEntry[]>;

  private readonly own = new Map<string, LibraryEntry[]>();

  private readonly index = new Map<string, Item[]>();
  private decoded = new Map<LibraryEntry, PlayerInput[]>();

  added = 0;
  saved = 0;

  readonly learn: boolean;

  constructor(tiles?: Record<string, LibraryEntry[]>, learn = process.env.SEGMENT_LEARN !== "0", own?: Record<string, LibraryEntry[]>) {
    this.tiles = new Map(Object.entries(tiles ?? {}).map(([k, v]) => [k, [...v]]));
    this.learn = learn;
    for (const [k, mine] of Object.entries(own ?? {})) {
      const list = this.tiles.get(k) ?? [];
      const known = new Set(list.map((e) => e.join(",")));
      const keep: LibraryEntry[] = [];
      for (const e of mine) {
        if (list.length >= PER_TILE) break;
        const id = e.join(",");
        if (known.has(id)) continue;
        known.add(id);
        list.push(e);
        keep.push(e);
      }
      this.tiles.set(k, list);
      if (keep.length > 0) this.own.set(k, keep);
    }
    for (const list of this.tiles.values()) for (const e of list) this.indexEntry(e);
  }

  private indexEntry(e: LibraryEntry): void {
    for (const it of itemsOf(e)) {
      const key = `${tileOf(it.h[0])},${tileOf(it.h[1])}`;
      const l = this.index.get(key);
      if (l === undefined) this.index.set(key, [it]);
      else l.push(it);
    }
  }

  get size(): number {
    let n = 0;
    for (const v of this.tiles.values()) n += v.length;
    return n;
  }

  private tilesAround(st: Float64Array, off: number): LibraryEntry[][] {
    const tx = tileOf(st[off + FLAT_POS_X]);
    const ty = tileOf(st[off + FLAT_POS_Y]);
    const out: LibraryEntry[][] = [];
    for (const x of [tx, tx - 1, tx + 1]) {
      const l = this.tiles.get(`${x},${ty}`);
      if (l !== undefined) out.push(l);
    }
    return out;
  }

  candidates(st: Float64Array, off: number, ask = ASK, reach = MAX_DIST, way = true): Candidate[] {
    const h = headOf(st, off);
    const tx = tileOf(st[off + FLAT_POS_X]);
    const ty = tileOf(st[off + FLAT_POS_Y]);
    const near: { d: number; it: Item }[] = [];
    const r = Math.max(1, Math.ceil(reach / 32));
    for (let y = ty - r; y <= ty + r; y++) {
      for (let x = tx - r; x <= tx + r; x++) {
        const list = this.index.get(`${x},${y}`);
        if (list === undefined) continue;
        for (const it of list) {
          if (!way && it.k > 0) continue;
          const d = dist(it.h, h);
          if (d <= reach) near.push({ d, it });
        }
      }
    }
    near.sort((a, b) => a.d - b.d);
    const out: Candidate[] = [];
    const seen = new Set<LibraryEntry>();
    for (const { d, it } of near) {
      if (out.length >= ask) break;
      if (seen.has(it.e)) continue;
      seen.add(it.e);
      let t = this.decoded.get(it.e);
      if (t === undefined) this.decoded.set(it.e, (t = decodeTape(it.e.slice(0, HEAD + it.e[8]), HEAD)));
      out.push({ tape: it.k === 0 ? t : t.slice(it.k), misses: it.e[7], from: { x: it.e[0], y: it.e[1] }, tick: it.k, d });
    }
    return out;
  }

  probe(st: Float64Array, off: number): { tile: number; kind: number; nearest: number } {
    const h = headOf(st, off);
    const tx = tileOf(st[off + FLAT_POS_X]);
    const ty = tileOf(st[off + FLAT_POS_Y]);
    let tile = 0;
    let kind = 0;
    let nearest = Infinity;
    for (let y = ty - 1; y <= ty + 1; y++) {
      for (let x = tx - 1; x <= tx + 1; x++) {
        for (const it of this.index.get(`${x},${y}`) ?? []) {
          tile++;
          const d = dist(it.h, h);
          if (d < Infinity) kind++;
          if (d < nearest) nearest = d;
        }
      }
    }
    return { tile, kind, nearest };
  }

  add(st: Float64Array, off: number, tape: readonly PlayerInput[], misses = 0, trajectory: readonly number[] = []): boolean {
    if (tape.length === 0 || !this.learn) return false;
    const h = headOf(st, off);
    const enc = encodeTape(tape);

    for (const list of this.tilesAround(st, off)) {
      for (const e of list) {
        if (dist(e, h) >= SAME_DIST || e[8] !== enc.length) continue;
        let same = true;
        for (let i = 0; i < enc.length && same; i++) same = e[HEAD + i] === enc[i];
        if (same) return false;
      }
    }
    const key = `${tileOf(st[off + FLAT_POS_X])},${tileOf(st[off + FLAT_POS_Y])}`;
    const list = this.tiles.get(key) ?? [];
    if (list.length >= PER_TILE) return false;
    const e = [...h, misses, enc.length, ...enc, ...trajectory];
    list.push(e);
    this.tiles.set(key, list);
    const mine = this.own.get(key);
    if (mine === undefined) this.own.set(key, [e]);
    else mine.push(e);
    this.indexEntry(e);
    this.added++;
    return true;
  }

  addEntries(tiles: Record<string, LibraryEntry[]>): number {
    let n = 0;
    for (const [key, entries] of Object.entries(tiles)) {
      const list = this.tiles.get(key) ?? [];
      const known = new Set(list.map((e) => e.join(",")));
      for (const e of entries) {
        if (list.length >= PER_TILE) break;
        const id = e.join(",");
        if (known.has(id)) continue;
        known.add(id);
        list.push(e);
        const mine = this.own.get(key);
        if (mine === undefined) this.own.set(key, [e]);
        else mine.push(e);
        this.indexEntry(e);
        this.added++;
        n++;
      }
      this.tiles.set(key, list);
    }
    return n;
  }

  learnedTier(): SegmentLibrary | null {
    if (this.secondary === null) {
      if (!this.learn) return null;
      this.secondary = new SegmentLibrary(undefined, true);
      for (const [id, lib] of libs) {
        if (lib !== this) continue;
        libs.set(`${id}+`, this.secondary);
        break;
      }
    }
    return this.secondary;
  }

  toJSON(): Record<string, LibraryEntry[]> {
    return Object.fromEntries(this.tiles);
  }

  ownJSON(): Record<string, LibraryEntry[]> {
    return Object.fromEntries(this.own);
  }
}

const libs = new Map<string, SegmentLibrary>();
let shipped: LibraryFile | null | undefined;

export function shippedLibraryFile(): LibraryFile | null {
  if (shipped !== undefined) return shipped;
  const where = process.env.SEGMENT_LIBRARY;
  if (where === "off") return (shipped = null);
  try {
    const f = JSON.parse(readFileSync(where ?? new URL("./segmentLibrary.json", import.meta.url), "utf8")) as LibraryFile;
    shipped = f.version === LIBRARY_VERSION && typeof f.maps === "object" && f.maps !== null ? f : null;
  } catch {
    shipped = null;
  }
  return shipped;
}

const goalKey = (spot: { tx: number; ty: number }): string => `${spot.tx},${spot.ty}`;

export function shippedLibraryHas(mapName: string, col: Collision, spot: { tx: number; ty: number }): boolean {
  if (process.env.SEGMENT_LIBRARY === "off") return false;
  const maps = shippedLibraryFile()?.maps;
  const at = maps === undefined ? undefined : matchMapKey(maps, mapName, col);
  const tiles = at === undefined || maps === undefined ? undefined : maps[at].goals[goalKey(spot)];
  if (tiles === undefined) return false;
  for (const list of Object.values(tiles)) if (list.length > 0) return true;
  return false;
}

export function libraryFor(mapName: string, col: Collision, spot: { tx: number; ty: number }): SegmentLibrary | null {
  if (process.env.SEGMENT_LIBRARY === "off") return null;
  const key = choiceKey(mapName, col);
  keepMap(key, col);

  if (!regionAsked.has(key)) {
    regionAsked.add(key);
    const m = userMaps[key];
    if (m !== undefined && !validRegion(m.region)) autoDirty.add(norm(mapName));
  }
  return libraryByKey(key, spot);
}

const regionAsked = new Set<string>();

export const MAPS_KEPT = 4;
const cols = new Map<string, Collision>();
function keepMap(key: string, col: Collision): void {
  cols.delete(key);
  cols.set(key, col);
  for (const k of cols.keys()) {
    if (cols.size <= MAPS_KEPT) break;
    cols.delete(k);
  }
}

export const keptMaps = (): string[] => [...cols.keys()];

type MapEntry = LibraryFile["maps"][string];

function sourcesOf(key: string): { shipped: MapEntry | undefined; others: MapEntry[] } {
  const col = cols.get(key);
  const maps = shippedLibraryFile()?.maps;
  if (col === undefined) return { shipped: maps?.[key], others: [] };
  const at = maps === undefined ? undefined : matchMapKey(maps, key.slice(0, key.lastIndexOf("|")), col);
  return { shipped: at === undefined || maps === undefined ? undefined : maps[at], others: regionMatches(key, col).map((k) => userMaps[k]) };
}

function regionMatches(key: string, col: Collision): string[] {
  const name = key.slice(0, key.lastIndexOf("|"));
  const out: string[] = [];
  let tried = 0;
  for (const [k, m] of Object.entries(userMaps)) {
    if (k === key || typeof m.name !== "string" || norm(m.name) !== name || !validRegion(m.region)) continue;
    if (++tried > REGION_CANDIDATES) break;
    if (regionHash(col, m.region) === m.region.hash) out.push(k);
  }
  return out;
}

export const REGION_CANDIDATES = 16;

function mergeTiles(lists: readonly (Record<string, LibraryEntry[]> | undefined)[]): Record<string, LibraryEntry[]> | undefined {
  const have = lists.filter((l): l is Record<string, LibraryEntry[]> => l !== undefined);
  if (have.length <= 1) return have[0];
  const out: Record<string, LibraryEntry[]> = {};
  for (const l of have) {
    for (const [tile, entries] of Object.entries(l)) {
      const into = (out[tile] ??= []);
      const known = new Set(into.map((e) => e.join(",")));
      for (const e of entries) {
        if (into.length >= PER_TILE) break;
        const id = e.join(",");
        if (known.has(id)) continue;
        known.add(id);
        into.push(e);
      }
    }
  }
  return out;
}

function libraryByKey(key: string, spot: { tx: number; ty: number }): SegmentLibrary {
  const id = `${key}#${goalKey(spot)}`;
  let lib = libs.get(id);
  if (lib === undefined) {

    savedRegions.delete(key);
    const { shipped: from, others } = sourcesOf(key);
    const own = (goal: string): Record<string, LibraryEntry[]> | undefined => mergeTiles([userMaps[key]?.goals[goal], ...others.map((m) => m.goals[goal])]);
    lib = new SegmentLibrary(from?.goals[goalKey(spot)], undefined, own(goalKey(spot)));
    libs.set(id, lib);
    const second = from?.goals[`${goalKey(spot)}+`];
    const secondOwn = own(`${goalKey(spot)}+`);
    if (second !== undefined || secondOwn !== undefined) {
      lib.secondary = new SegmentLibrary(second, undefined, secondOwn);
      libs.set(`${id}+`, lib.secondary);
    }
    const fast = from?.goals[`${goalKey(spot)}!`];
    if (fast !== undefined) {
      lib.fast = new SegmentLibrary(fast, false);
      libs.set(`${id}!`, lib.fast);
    }
  }
  return lib;
}

export function importLibrary(file: LibraryFile): number {
  let n = 0;
  for (const [key, m] of Object.entries(file.maps)) {
    for (const [goal, tiles] of Object.entries(m.goals)) {
      if (goal.endsWith("!")) continue;
      const second = goal.endsWith("+");
      const [tx, ty] = (second ? goal.slice(0, -1) : goal).split(",").map(Number);
      const lib = libraryByKey(key, { tx, ty });
      const target = second ? lib.learnedTier() : lib;
      if (target !== null) n += target.addEntries(tiles);
    }
  }
  return n;
}

let userMaps: LibraryFile["maps"] = {};
export function loadUserLibrary(file: string): boolean {
  try {
    const f = JSON.parse(readFileSync(file, "utf8")) as LibraryFile;
    if (f.version !== LIBRARY_VERSION || typeof f.maps !== "object" || f.maps === null) return false;
    const good: LibraryFile["maps"] = {};
    for (const [key, m] of Object.entries(f.maps)) {
      if (!wellShaped(m)) continue;
      if (m.region !== undefined && !validRegion(m.region)) delete m.region;
      good[key] = m;
    }
    userMaps = { ...userMaps, ...good };
    if (typeof f.auto === "object" && f.auto !== null && !Array.isArray(f.auto)) {
      for (const [key, a] of Object.entries(f.auto)) {
        const st = autoStateFrom(a);
        if (st !== null) userAuto[key] = st;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function wellShaped(m: unknown): m is LibraryFile["maps"][string] {
  if (typeof m !== "object" || m === null) return false;
  const goals = (m as { goals?: unknown }).goals;
  if (typeof goals !== "object" || goals === null || Array.isArray(goals)) return false;
  for (const tiles of Object.values(goals)) {
    if (typeof tiles !== "object" || tiles === null || Array.isArray(tiles)) return false;
    for (const list of Object.values(tiles)) if (!Array.isArray(list) || !list.every((e) => Array.isArray(e))) return false;
  }
  return true;
}

const JOB_ID = /^-?\d+,-?\d+>-?\d+,-?\d+$/;
function isArm(a: unknown): boolean {
  if (typeof a !== "object" || a === null) return false;
  const o = a as Record<string, unknown>;
  return ["walks", "arrived", "kills", "freezes", "median"].every((k) => typeof o[k] === "number") && (o.mean === undefined || typeof o.mean === "number");
}
function autoStateFrom(a: unknown): AutoState | null {
  if (typeof a !== "object" || a === null || Array.isArray(a)) return null;
  const o = a as { name?: unknown; spec?: unknown; jobs?: unknown; failed?: unknown; fails?: unknown };
  if (typeof o.name !== "string" || typeof o.spec !== "string" || typeof o.jobs !== "object" || o.jobs === null || Array.isArray(o.jobs)) return null;
  const jobs: Record<string, AutoJob> = {};
  for (const [id, j] of Object.entries(o.jobs)) {
    if (!JOB_ID.test(id) || typeof j !== "object" || j === null || Array.isArray(j)) continue;
    const { built, verdict } = j as { built?: unknown; verdict?: unknown };
    if (built !== undefined && typeof built !== "boolean") continue;
    if (verdict !== undefined) {
      const v = verdict as { use?: unknown; why?: unknown; walker?: unknown; swing?: unknown } | null;
      if (typeof v !== "object" || v === null || typeof v.use !== "boolean" || typeof v.why !== "string" || !isArm(v.walker) || !isArm(v.swing)) continue;
    }
    jobs[id] = j as AutoJob;
  }
  const st: AutoState = { name: o.name, spec: o.spec, jobs };
  if (typeof o.failed === "string") st.failed = o.failed;
  if (typeof o.fails === "number" && Number.isFinite(o.fails)) st.fails = o.fails;
  return st;
}

let userAuto: Record<string, AutoState> = {};

const autoDirty = new Set<string>();

export function autoKeyOf(mapName: string, col: Collision): string | undefined {
  const own = choiceKey(mapName, col);
  if (userAuto[own] !== undefined) return own;
  return regionMatches(own, col).find((k) => userAuto[k] !== undefined);
}

export function autoStateOf(mapName: string, col: Collision): AutoState | undefined {
  const k = autoKeyOf(mapName, col);
  return k === undefined ? undefined : userAuto[k];
}

export function setAutoState(mapName: string, col: Collision, st: AutoState): void {
  userAuto[choiceKey(mapName, col)] = st;
  autoDirty.add(mapName.trim().toLowerCase());
}

export const autoJobId = (spawn: { tx: number; ty: number }, spot: { tx: number; ty: number }): string => `${spawn.tx},${spawn.ty}>${spot.tx},${spot.ty}`;

export function autoWalkUse(mapName: string, col: Collision, from: { tx: number; ty: number }, spot: { tx: number; ty: number }): boolean {
  return autoStateOf(mapName, col)?.jobs[autoJobId(from, spot)]?.verdict?.use === true;
}

export function autoWalkKnown(mapName: string, col: Collision, from: { tx: number; ty: number }, spot: { tx: number; ty: number }): boolean {
  return autoStateOf(mapName, col)?.jobs[autoJobId(from, spot)]?.verdict !== undefined;
}

export function autoSpotsUsed(mapName: string, col: Collision): { tx: number; ty: number }[] {
  const out = new Map<string, { tx: number; ty: number }>();
  for (const [id, j] of Object.entries(autoStateOf(mapName, col)?.jobs ?? {})) {
    if (j.verdict?.use !== true) continue;
    const [tx, ty] = id.split(">")[1].split(",").map(Number);
    out.set(`${tx},${ty}`, { tx, ty });
  }
  return [...out.values()];
}

export function autoSpotUse(mapName: string, col: Collision, spot: { tx: number; ty: number }): boolean {
  const jobs = autoStateOf(mapName, col)?.jobs;
  if (jobs === undefined) return false;
  const tail = `>${spot.tx},${spot.ty}`;
  for (const [id, j] of Object.entries(jobs)) if (j.verdict?.use === true && id.endsWith(tail)) return true;
  return false;
}

export function userLibraryDirty(mapName: string): boolean {
  const want = mapName.trim().toLowerCase();
  if (autoDirty.has(want)) return true;
  for (const [id, lib] of libs) if (id.split("|")[0] === want && lib.added > lib.saved) return true;
  return false;
}

export function saveUserLibrary(file: string, mapName: string): boolean {
  const want = mapName.trim().toLowerCase();
  const maps: LibraryFile["maps"] = {};
  for (const [k, v] of Object.entries(userMaps)) if (v.name === want) maps[k] = { name: v.name, goals: { ...v.goals }, ...(v.region === undefined ? {} : { region: v.region }) };
  for (const [id, lib] of libs) {
    const [key, goal] = id.split("#");
    const name = key.split("|")[0];
    if (name !== want) continue;
    const own = lib.ownJSON();
    const m = (maps[key] ??= { name, goals: {} });
    if (Object.keys(own).length > 0) m.goals[goal] = own;
    else delete m.goals[goal];
  }
  for (const [k, v] of Object.entries(maps)) if (Object.keys(v.goals).length === 0) delete maps[k];

  for (const [k, v] of Object.entries(maps)) {
    const n = programsIn(v.goals);
    const made = savedRegions.get(k);
    if (made !== undefined && made.n === n) {
      v.region = made.region;
      continue;
    }
    const col = cols.get(k);
    if (col === undefined) {
      if (n !== programsIn(userMaps[k]?.goals ?? {})) delete v.region;
      continue;
    }
    const region = libraryRegion(v.goals, col);
    if (region === undefined) delete v.region;
    else {
      v.region = region;
      savedRegions.set(k, { n, region });
    }
  }
  const auto: Record<string, AutoState> = {};
  for (const [k, v] of Object.entries(userAuto)) if (k.split("|")[0] === want) auto[k] = v;
  if (Object.keys(maps).length === 0 && Object.keys(auto).length === 0) return false;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(Object.keys(auto).length > 0 ? { version: LIBRARY_VERSION, maps, auto } : { version: LIBRARY_VERSION, maps }));
    renameSync(`${file}.tmp`, file);
    for (const [id, lib] of libs) if (id.split("|")[0] === want) lib.saved = lib.added;
    autoDirty.delete(want);
    return true;
  } catch {
    return false;
  }
}

const savedRegions = new Map<string, { n: number; region: Region }>();
const programsIn = (goals: LibraryFile["maps"][string]["goals"]): number => {
  let n = 0;
  for (const tiles of Object.values(goals)) for (const list of Object.values(tiles)) n += list.length;
  return n;
};

export function libraryFile(): LibraryFile {
  const maps: LibraryFile["maps"] = {};
  for (const [id, lib] of libs) {
    if (lib.size === 0) continue;
    const [key, goal] = id.split("#");
    const name = key.split("|")[0];
    const m = (maps[key] ??= { name, goals: {} });
    m.goals[goal] = lib.toJSON();
  }
  return { version: LIBRARY_VERSION, maps };
}

export function libraryRegion(goals: LibraryFile["maps"][string]["goals"], col: Collision): Region | undefined {
  const acc: { b: Box | null } = { b: null };
  const add = (tx: number, ty: number): void => {
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
    acc.b = acc.b === null ? { x0: tx, y0: ty, x1: tx, y1: ty } : unionBox(acc.b, { x0: tx, y0: ty, x1: tx, y1: ty });
  };
  for (const [goal, tiles] of Object.entries(goals)) {
    const [gx, gy] = goal.replace(/[+!]$/, "").split(",").map(Number);
    let any = false;
    for (const [tile, entries] of Object.entries(tiles)) {
      if (entries.length === 0) continue;
      any = true;
      const [kx, ky] = tile.split(",").map(Number);
      add(kx, ky);
      for (const e of entries) {
        add(tileOf(e[0]), tileOf(e[1]));

        if (!Number.isInteger(e[8]) || e[8] < 0) continue;
        const program = Math.min(HEAD + e[8], e.length);
        for (let i = program; i + TRAJ_WIDTH <= e.length; i += TRAJ_WIDTH) add(tileOf(e[i]), tileOf(e[i + 1]));
        for (let i = HEAD; i + 5 < program; i += 6) if (e[i + 1] >= ABS_AIM / 2) add(tileOf(e[i + 1] - ABS_AIM), tileOf(e[i + 2] - ABS_AIM));
      }
    }
    if (any) add(gx, gy);
  }
  return acc.b === null ? undefined : regionOf(col, regionBox(col, acc.b));
}

export function addRegions(file: LibraryFile, cols: Iterable<Collision>): LibraryFile {
  const list = [...cols];
  for (const [key, m] of Object.entries(file.maps)) {
    const col = list.find((c) => choiceKey(m.name, c) === key);
    const region = col === undefined ? undefined : libraryRegion(m.goals, col);
    if (region !== undefined) m.region = region;
  }
  return file;
}

export function ownLibraryFile(key?: string, goals?: ReadonlySet<string>): LibraryFile {
  const maps: LibraryFile["maps"] = {};
  for (const [id, lib] of libs) {
    const [k, goal] = id.split("#");
    if ((key !== undefined && k !== key) || (goals !== undefined && !goals.has(goal.endsWith("+") ? goal.slice(0, -1) : goal))) continue;
    const own = lib.ownJSON();
    if (Object.keys(own).length === 0) continue;
    (maps[k] ??= { name: k.split("|")[0], goals: {} }).goals[goal] = own;
  }
  return { version: LIBRARY_VERSION, maps };
}

export function resetLibraries(): void {
  libs.clear();
  userMaps = {};
  userAuto = {};
  autoDirty.clear();
  cols.clear();
  savedRegions.clear();
  regionAsked.clear();
  shipped = undefined;
}
