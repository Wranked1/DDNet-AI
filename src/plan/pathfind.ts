import type { Collision } from "../core/collision.ts";
import { HOOK_FLYING, HOOK_GRABBED, HOOK_IDLE } from "../core/characterCore.ts";
import type { CharacterCore } from "../core/characterCore.ts";
import { CFLAG_NOHOOK, PHYSICAL_SIZE, TUNING } from "../core/tuning.ts";
import type { PlayerInput, TeeState } from "../core/types.ts";
import { emptyInput } from "../core/types.ts";
import { TRAJ_EVERY, libraryEntry, resolveAim, trajectoryNumbers } from "./segmentLibrary.ts";
import type { Candidate, LibraryEntry, SegmentLibrary } from "./segmentLibrary.ts";
import { FLAT_FREEZE_LEFT, FLAT_JUMPED, FLAT_TICK, FLAT_HOOK_STATE, FLAT_HOOK_X, FLAT_HOOK_Y, FLAT_POS_X, FLAT_POS_Y, FLAT_PREV_X, FLAT_PREV_Y, FLAT_STRIDE, FLAT_VEL_X, FLAT_VEL_Y, SimWorld } from "../core/world.ts";

export type TileBox = { x0: number; y0: number; x1: number; y1: number };

export type PathGoal = { zone: readonly TileBox[]; spots: readonly { tx: number; ty: number }[]; stop: boolean; enter?: boolean };

const TILE = 32;
const HALF = PHYSICAL_SIZE / 2;

const NO_KEYS: PlayerInput = emptyInput();

export function restSafe(sim: SimWorld, st: Float64Array, off: number, ticks: number): boolean {
  return restPlay(sim, st, off, ticks) >= 0;
}

function restPlay(sim: SimWorld, st: Float64Array, off: number, ticks: number): number {
  sim.loadFlat(0, st, off);
  sim.setInput(0, NO_KEYS);
  for (let t = 0; t < ticks; t++) {
    sim.step();
    if (!sim.isAlive(0) || sim.freezeTicksOf(0) > 0) return -(t + 1);
  }
  return ticks;
}

function grounded(col: Collision, x: number, y: number): boolean {
  return col.isSolid(x + HALF, y + HALF + 5) || col.isSolid(x - HALF, y + HALF + 5);
}

export function goalReached(col: Collision, goal: PathGoal, x: number, y: number, vx: number, frozen: boolean): boolean {
  if (frozen && goal.enter !== true) return false;
  const tx = Math.trunc(x / TILE);
  const ty = Math.trunc(y / TILE);
  let inZone = false;
  for (const b of goal.zone) if (tx >= b.x0 && tx <= b.x1 && ty >= b.y0 && ty <= b.y1) inZone = true;
  if (!inZone) return false;
  if (goal.enter === true) return true;
  let near = false;
  for (const s of goal.spots) if (Math.max(Math.abs(x / TILE - (s.tx + 0.5)), Math.abs(y / TILE - (s.ty + 0.5))) <= 1) near = true;
  if (!near) return false;
  if (goal.stop && (!grounded(col, x, y) || Math.abs(vx) > 3)) return false;
  return true;
}

class MinHeap {
  ids: Int32Array;
  keys: Float64Array;
  len = 0;
  constructor(cap: number) {
    this.ids = new Int32Array(Math.max(16, cap));
    this.keys = new Float64Array(Math.max(16, cap));
  }
  clear(): void {
    this.len = 0;
  }
  push(id: number, key: number): void {
    if (this.len === this.ids.length) {
      const ids = new Int32Array(this.ids.length * 2);
      ids.set(this.ids);
      this.ids = ids;
      const keys = new Float64Array(this.keys.length * 2);
      keys.set(this.keys);
      this.keys = keys;
    }
    const { ids, keys } = this;
    let c = this.len++;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (keys[p] <= key) break;
      ids[c] = ids[p];
      keys[c] = keys[p];
      c = p;
    }
    ids[c] = id;
    keys[c] = key;
  }
  topKey(): number {
    return this.keys[0];
  }
  pop(): number {
    const { ids, keys } = this;
    const top = ids[0];
    const len = --this.len;
    if (len > 0) {
      const id = ids[len];
      const key = keys[len];
      let c = 0;
      for (;;) {
        const l = 2 * c + 1;
        if (l >= len) break;
        const r = l + 1;
        const m = r < len && keys[r] < keys[l] ? r : l;
        if (keys[m] >= key) break;
        ids[c] = ids[m];
        keys[c] = keys[m];
        c = m;
      }
      ids[c] = id;
      keys[c] = key;
    }
    return top;
  }
}

export const UNFREEZE_NEAR_TILES = 4;
export function unfreezeNear(col: Collision): Uint8Array {
  const TW = col.width;
  const TH = col.height;
  const near = new Uint8Array(TW * TH);
  const n = UNFREEZE_NEAR_TILES;
  for (let y = 0; y < TH; y++) {
    for (let x = 0; x < TW; x++) {
      if (!col.isUnFreeze(x * TILE + 16, y * TILE + 16)) continue;
      for (let dy = -n; dy <= n; dy++) {
        for (let dx = -n; dx <= n; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < TW && ny < TH) near[ny * TW + nx] = 1;
        }
      }
    }
  }
  return near;
}

export const DEAD_FREEZE_TICKS = 120;

export function buildField(col: Collision, goal: PathGoal, v: number, nearU: Uint8Array): Float64Array {
  const TW = col.width;
  const TH = col.height;
  const solidT = (x: number, y: number): boolean => col.isSolid(x * TILE + 16, y * TILE + 16);
  const freezeT = (x: number, y: number): boolean => col.isFreeze(x * TILE + 16, y * TILE + 16);
  const deathT = (x: number, y: number): boolean => col.isDeath(x * TILE + 16, y * TILE + 16);
  const field = new Float64Array(TW * TH).fill(Infinity);
  const heap = new MinHeap(1024);
  const inZone = (tx: number, ty: number): boolean => goal.zone.some((b) => tx >= b.x0 && tx <= b.x1 && ty >= b.y0 && ty <= b.y1);
  if (goal.enter === true) {

    for (const b of goal.zone) {
      for (let ty = b.y0; ty <= b.y1; ty++) {
        for (let tx = b.x0; tx <= b.x1; tx++) {
          if (tx < 0 || ty < 0 || tx >= TW || ty >= TH || solidT(tx, ty) || deathT(tx, ty) || field[ty * TW + tx] === 0) continue;
          field[ty * TW + tx] = 0;
          heap.push(ty * TW + tx, 0);
        }
      }
    }
  } else {
    for (const s of goal.spots) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tx = s.tx + dx;
          const ty = s.ty + dy;
          if (tx < 0 || ty < 0 || tx >= TW || ty >= TH) continue;
          if (solidT(tx, ty) || freezeT(tx, ty) || deathT(tx, ty) || !inZone(tx, ty)) continue;
          field[ty * TW + tx] = 0;
          heap.push(ty * TW + tx, 0);
        }
      }
    }
  }
  const step = TILE / v;
  while (heap.len > 0) {
    const d = heap.topKey();
    const i = heap.pop();
    if (d > field[i]) continue;
    const x = i % TW;
    const y = (i - x) / TW;

    const thaw = goal.enter !== true && freezeT(x, y) && nearU[i] === 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= TW || ny >= TH) continue;
        if (solidT(nx, ny) || deathT(nx, ny)) continue;
        if (ox !== 0 && oy !== 0 && (solidT(x + ox, y) || solidT(x, y + oy))) continue;
        let c = ox !== 0 && oy !== 0 ? step * Math.SQRT2 : step;
        if (thaw && !freezeT(nx, ny)) c += DEAD_FREEZE_TICKS;
        const ni = ny * TW + nx;
        if (d + c < field[ni]) {
          field[ni] = d + c;
          heap.push(ni, d + c);
        }
      }
    }
  }
  return field;
}

export function trapFreeze(col: Collision): Uint8Array {
  const TW = col.width;
  const TH = col.height;
  const trap = new Uint8Array(TW * TH);
  for (let x = 0; x < TW; x++) {
    let onSolid = true;
    for (let y = TH - 1; y >= 0; y--) {
      if (col.isSolid(x * TILE + 16, y * TILE + 16)) {
        onSolid = true;
        continue;
      }
      if (col.isFreeze(x * TILE + 16, y * TILE + 16)) {
        if (onSolid) trap[y * TW + x] = 1;
        continue;
      }
      onSolid = false;
    }
  }
  return trap;
}

type MapTables = { revision: number; nearU: Uint8Array | null; trap: Uint8Array | null; fields: Map<string, Float64Array> };
const mapTables = new WeakMap<Collision, MapTables>();

const MAX_FIELDS = 8;
function tablesOf(col: Collision): MapTables {
  let t = mapTables.get(col);
  if (t === undefined || t.revision !== col.revision) {
    t = { revision: col.revision, nearU: null, trap: null, fields: new Map() };
    mapTables.set(col, t);
  }
  return t;
}
export function unfreezeNearOf(col: Collision): Uint8Array {
  const t = tablesOf(col);
  return (t.nearU ??= unfreezeNear(col));
}
export function trapFreezeOf(col: Collision): Uint8Array {
  const t = tablesOf(col);
  return (t.trap ??= trapFreeze(col));
}
export function fieldOf(col: Collision, goal: PathGoal, v: number): Float64Array {
  const t = tablesOf(col);
  const key = `${goal.enter === true ? "enter|" : ""}${v}|${goal.zone.map((b) => `${b.x0},${b.y0},${b.x1},${b.y1}`).join(";")}|${goal.spots.map((s) => `${s.tx},${s.ty}`).join(";")}`;
  let f = t.fields.get(key);
  if (f === undefined) {
    f = buildField(col, goal, v, unfreezeNearOf(col));
    if (t.fields.size >= MAX_FIELDS) t.fields.delete(t.fields.keys().next().value as string);
    t.fields.set(key, f);
  }
  return f;
}

export function prepareSearch(col: Collision, goal: PathGoal, v: number = DEFAULT_SEARCH.v): void {
  trapFreezeOf(col);
  fieldOf(col, goal, v);
}

export function preparedFields(col: Collision): number {
  const t = mapTables.get(col);
  return t === undefined || t.revision !== col.revision ? 0 : t.fields.size;
}

export const MACRO_TICKS = 4;

export type Macro = { dir: number; jump: number; hook: number; ang: number };

export const MACRO_WAIT = -1;
export const MACRO_ROOT = -2;

export const THROW_DIRS = 64;
const ANG_X = new Float64Array(THROW_DIRS);
const ANG_Y = new Float64Array(THROW_DIRS);
for (let i = 0; i < THROW_DIRS; i++) {
  ANG_X[i] = Math.cos((i / THROW_DIRS) * 2 * Math.PI);
  ANG_Y[i] = Math.sin((i / THROW_DIRS) * 2 * Math.PI);
}

export const encodeMacro = (m: Macro): number => (m.dir + 1) | (m.jump << 2) | (m.hook << 3) | (m.ang << 6);
export const decodeMacro = (c: number): Macro => ({ dir: (c & 3) - 1, jump: (c >> 2) & 1, hook: (c >> 3) & 7, ang: c >> 6 });

export function macroInput(code: number, t: number, startIdle: boolean, out: PlayerInput): PlayerInput {
  out.direction = 0;
  out.jump = 0;
  out.hook = 0;
  out.targetX = 0;
  out.targetY = -1;
  if (code < 0) return out;
  const m = decodeMacro(code);
  out.direction = m.dir;
  out.jump = m.jump === 1 && t < 2 ? 1 : 0;
  if (m.hook === 1) out.hook = 1;
  else if (m.hook === 3) out.hook = t < 2 ? 1 : 0;
  else if (m.hook === 2) {
    out.hook = startIdle || t >= 2 ? 1 : 0;
    out.targetX = Math.round(ANG_X[m.ang] * 256);
    out.targetY = Math.round(ANG_Y[m.ang] * 256);
  }
  return out;
}

export function describeProgram(codes: readonly number[], edgeTicks: readonly number[]): string {
  let at = 0;
  const parts: string[] = [];
  for (let e = 0; e < codes.length; e++) {
    const c = codes[e];
    if (c === MACRO_WAIT) parts.push(`${at}:wait${edgeTicks[e]}`);
    else {
      const m = decodeMacro(c);
      const rope = m.hook === 0 ? "" : m.hook === 1 ? "h" : m.hook === 3 ? "h2" : `T${Math.round((m.ang * 360) / THROW_DIRS)}`;
      parts.push(`${at}:${m.dir < 0 ? "L" : m.dir > 0 ? "R" : "-"}${m.jump ? "J" : ""}${rope}`);
    }
    at += edgeTicks[e];
  }
  return parts.join(" ");
}

export type PathSearchOpts = {

  maxNodes: number;

  maxExpansions: number;
  improveExpansions: number;

  timeLimitMs: number;

  w: number;

  v: number;

  particles: number;
  dev: number;

  late: boolean;

  roots: boolean;

  maxAnchors: number;

  regionMargin: number;

  clearPx: number;
  clearCost: number;

  restTicks: number;
  log: boolean;
};

export const DEFAULT_SEARCH: PathSearchOpts = {
  maxNodes: 300_000,
  maxExpansions: 80_000,
  improveExpansions: 15_000,
  timeLimitMs: 120_000,
  w: 1.0,
  v: 12,
  particles: 1,
  dev: 40,
  late: false,
  roots: false,
  maxAnchors: 6,
  regionMargin: 25,
  clearPx: 0,
  clearCost: 0,
  restTicks: 0,
  log: false,
};

export type Route = {

  ticks: number;
  codes: number[];
  edgeTicks: number[];

  inputs: PlayerInput[];
  states: Float64Array;
  expanded: number;
  nodes: number;
  ms: number;
  simTicks: number;

  freezes: number;

  rejoinAt?: number;

  stopped?: "time" | "nodes" | "expansions";

  segmentEnd?: boolean;
};

const KEY_CELLS = 2048;

export class PathSearcher {
  readonly col: Collision;
  readonly goal: PathGoal;
  readonly o: PathSearchOpts;
  readonly region: TileBox;
  private readonly sim: SimWorld;
  private restSim: SimWorld | null = null;
  private readonly core: CharacterCore;
  private readonly field: Float64Array;
  private readonly nearU: Uint8Array;
  private readonly trap: Uint8Array;
  private readonly TW: number;
  private readonly TH: number;
  private readonly cellX0: number;
  private readonly cellY0: number;
  private readonly anchorCache = new Map<number, number[]>();
  private readonly P: number;
  private readonly W: number;

  private cap = 0;
  private pool = new Float64Array(0);
  private gArr = new Int32Array(0);
  private parent = new Int32Array(0);
  private codeArr = new Int32Array(0);
  private ticksArr = new Int16Array(0);
  private depthArr = new Int32Array(0);
  private readonly heap = new MinHeap(1024);
  private nNodes = 0;
  private readonly best = new Map<number, number>();
  private readonly inp: PlayerInput = emptyInput();
  private readonly prevInp: PlayerInput = emptyInput();
  private readonly waitInp: PlayerInput = emptyInput();
  private readonly scratch: Float64Array;
  private readonly goalAt: Int32Array;
  private goalHit = false;
  private edgePen = 0;
  simTicks = 0;

  totalSim = 0;
  totalMs = 0;
  runs = 0;

  private rj: { states: Float64Array; total: number; grid: Map<number, number[]> } | null = null;
  private goalExtra = 0;
  private rejoinIdx = -1;
  private readonly regionAround: { tx: number; ty: number };

  private goalKind = 0;

  private segFieldAtMost: number | null = null;

  constructor(col: Collision, goal: PathGoal, opts: Partial<PathSearchOpts>, regionAround: { tx: number; ty: number }) {
    this.col = col;
    this.goal = goal;
    this.regionAround = { ...regionAround };
    this.o = { ...DEFAULT_SEARCH, ...opts };
    if (this.o.particles < 1 || this.o.particles > 8) throw new Error(`particles ${this.o.particles}: 1 to 8`);
    this.sim = new SimWorld(col, { respawnDelayTicks: 1_000_000 });
    this.sim.addTee(0, { x: regionAround.tx * TILE + 16, y: regionAround.ty * TILE + 16 });
    this.core = this.sim.coreOf(0) as CharacterCore;
    this.TW = col.width;
    this.TH = col.height;
    this.P = this.o.particles;
    this.W = FLAT_STRIDE * this.P;
    this.scratch = new Float64Array(this.W);
    this.goalAt = new Int32Array(this.P);
    const m = this.o.regionMargin;
    this.region = {
      x0: Math.min(regionAround.tx, ...goal.zone.map((b) => b.x0)) - m,
      x1: Math.max(regionAround.tx, ...goal.zone.map((b) => b.x1)) + m,
      y0: Math.min(regionAround.ty, ...goal.zone.map((b) => b.y0)) - m,
      y1: Math.max(regionAround.ty, ...goal.zone.map((b) => b.y1)) + m,
    };
    this.cellX0 = this.region.x0 * 4;
    this.cellY0 = this.region.y0 * 4;

    this.nearU = unfreezeNearOf(col);
    this.field = fieldOf(col, goal, this.o.v);
    this.trap = trapFreezeOf(col);
  }

  withOpts(opts: Partial<PathSearchOpts>): PathSearcher {
    return new PathSearcher(this.col, this.goal, { ...this.o, ...opts }, this.regionAround);
  }

  fieldAt(px: number, py: number): number {
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    if (tx < 0 || ty < 0 || tx >= this.TW || ty >= this.TH) return Infinity;
    let v = this.field[ty * this.TW + tx];
    if (!Number.isFinite(v)) {
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = tx + ox;
          const ny = ty + oy;
          if (nx >= 0 && ny >= 0 && nx < this.TW && ny < this.TH) v = Math.min(v, this.field[ny * this.TW + nx] + TILE / this.o.v);
        }
      }
    }
    return v;
  }

  private h(): number {
    const c = this.core;
    let v = this.fieldAt(c.pos.x, c.pos.y);
    const left = this.sim.freezeTicksOf(0);
    if (left > 0) {
      const tx = Math.trunc(c.pos.x / TILE);
      const ty = Math.trunc(c.pos.y / TILE);
      if (tx >= 0 && ty >= 0 && tx < this.TW && ty < this.TH && this.nearU[ty * this.TW + tx] === 0) v = Math.max(v, left);
    }
    return v;
  }

  atGoal(w: SimWorld): boolean {
    const c = w.coreOf(0);
    if (c === undefined || !w.isAlive(0)) return false;
    return goalReached(this.col, this.goal, c.pos.x, c.pos.y, c.vel.x, w.freezeTicksOf(0) > 0);
  }

  private keyOf(): number {
    const c = this.core;
    const cx = Math.max(0, Math.min(KEY_CELLS - 1, (c.pos.x >> 3) - this.cellX0));
    const cy = Math.max(0, Math.min(KEY_CELLS - 1, (c.pos.y >> 3) - this.cellY0));
    const vxb = Math.max(-63, Math.min(63, Math.round(c.vel.x))) + 64;
    const vyb = Math.max(-63, Math.min(63, Math.round(c.vel.y / 1.5))) + 64;
    const hs = c.hookState;
    const hp = hs === HOOK_GRABBED ? 2 : hs === HOOK_FLYING ? 1 : 0;
    let anc = 0;
    if (hp === 2) anc = ((c.hookPos.x >> 5) * 977 + (c.hookPos.y >> 5)) & 1023;
    else if (hp === 1) anc = (Math.round(Math.atan2(c.hookDir.y, c.hookDir.x) * 32) + 512) & 1023;
    const jb = c.jumped & 3;
    const left = this.sim.freezeTicksOf(0);
    const fz = left > 0 ? Math.min(7, 1 + (left >> 5)) : 0;
    return (((((((cx * KEY_CELLS + cy) * 128 + vxb) * 128 + vyb) * 4 + hp) * 1024 + anc) * 4 + jb) * 8) + fz;
  }

  keyOfState(st: Float64Array, off = 0): number {
    this.sim.loadFlat(0, st, off);
    return this.keyOf();
  }

  anchorsFrom(x: number, y: number): number[] {
    const key = (x >> 3) * 8192 + (y >> 3);
    const cached = this.anchorCache.get(key);
    if (cached !== undefined) return cached;
    const groups: { tile: number; angs: number[] }[] = [];
    const reach = TUNING.hookLength - 4;
    for (let i = 0; i < THROW_DIRS; i++) {
      const r = this.col.intersectLineHook({ x: x + ANG_X[i] * 42, y: y + ANG_Y[i] * 42 }, { x: x + ANG_X[i] * reach, y: y + ANG_Y[i] * reach });
      if (r.collision === 0 || (r.collision & CFLAG_NOHOOK) !== 0) continue;
      const tile = Math.trunc(r.outPos.y / TILE) * this.TW + Math.trunc(r.outPos.x / TILE);
      const g = groups.find((q) => q.tile === tile);
      if (g !== undefined) g.angs.push(i);
      else groups.push({ tile, angs: [i] });
    }
    let out = groups.map((g) => g.angs[Math.floor(g.angs.length / 2)]);
    if (out.length > this.o.maxAnchors) {
      out.sort((a, b) => a - b);
      const pick: number[] = [];
      for (let i = 0; i < this.o.maxAnchors; i++) pick.push(out[Math.floor((i * out.length) / this.o.maxAnchors)]);
      out = pick;
    }
    this.anchorCache.set(key, out);
    return out;
  }

  macrosAt(st: Float64Array, off: number, out: number[]): number[] {
    this.sim.loadFlat(0, st, off);
    return this.macrosHere(out);
  }

  private macrosHere(out: number[]): number[] {
    out.length = 0;
    if (this.sim.freezeTicksOf(0) > 0) {
      out.push(MACRO_WAIT);
      return out;
    }
    const c = this.core;
    const attached = c.hookState === HOOK_GRABBED || c.hookState === HOOK_FLYING;
    const canJump = grounded(this.col, c.pos.x, c.pos.y) || (c.jumped & 2) === 0;
    for (let dir = -1; dir <= 1; dir++) {
      for (let jump = 0; jump <= (canJump ? 1 : 0); jump++) {
        out.push(encodeMacro({ dir, jump, hook: 0, ang: 0 }));
        if (attached) {
          out.push(encodeMacro({ dir, jump, hook: 1, ang: 0 }));
          out.push(encodeMacro({ dir, jump, hook: 3, ang: 0 }));
        }
      }
    }
    if (this.o.maxAnchors > 0) for (const a of this.anchorsFrom(c.pos.x, c.pos.y)) for (let dir = -1; dir <= 1; dir++) out.push(encodeMacro({ dir, jump: 0, hook: 2, ang: a }));
    return out;
  }

  private delay(j: number, d: number): number {
    if (j === 0) return 0;
    let x = (j * 2654435761 + d * 40503) >>> 0;
    x ^= x >>> 15;
    x = Math.imul(x, 2246822519) >>> 0;
    x ^= x >>> 13;
    return x & 1;
  }

  private inRegion(): boolean {
    const tx = this.core.pos.x / TILE;
    const ty = this.core.pos.y / TILE;
    const r = this.region;
    return tx >= r.x0 && tx <= r.x1 && ty >= r.y0 && ty <= r.y1;
  }

  private lyingInFreeze(): boolean {
    const c = this.core;
    return Math.abs(c.vel.x) < 0.3 && Math.abs(c.vel.y) < 0.6 && this.col.isFreeze(c.pos.x, c.pos.y);
  }

  private clearancePenalty(): number {
    const c = this.core;
    const d = this.o.clearPx;
    const tx0 = Math.max(0, Math.trunc((c.pos.x - d) / TILE));
    const tx1 = Math.min(this.TW - 1, Math.trunc((c.pos.x + d) / TILE));
    const ty0 = Math.max(0, Math.trunc((c.pos.y - d) / TILE));
    const ty1 = Math.min(this.TH - 1, Math.trunc((c.pos.y + d) / TILE));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (this.trap[ty * this.TW + tx] === 1) return this.o.clearCost;
    return 0;
  }

  private mayEnd(): boolean {
    if (this.rj !== null && this.rejoinCost() >= 0) return true;
    const at = this.segFieldAtMost;
    if (at === null || this.sim.freezeTicksOf(0) > 0) return false;
    const c = this.core;
    return grounded(this.col, c.pos.x, c.pos.y) && this.fieldAt(c.pos.x, c.pos.y) <= at;
  }

  setSegment(fieldAtMost: number | null): void {
    this.segFieldAtMost = fieldAtMost;
  }

  private segmentEnd(): boolean {
    const at = this.segFieldAtMost;
    if (at === null) return false;
    const sc = this.scratch;
    for (let j = 0; j < this.P; j++) {
      const o = j * FLAT_STRIDE;
      if (sc[o + FLAT_FREEZE_LEFT] > 0 || !grounded(this.col, sc[o + FLAT_POS_X], sc[o + FLAT_POS_Y])) return false;
    }
    const f = this.fieldAt(sc[FLAT_POS_X], sc[FLAT_POS_Y]);
    if (!(f <= at)) return false;
    if (this.o.restTicks > 0) {
      if (this.restSim === null) {
        this.restSim = new SimWorld(this.col, { respawnDelayTicks: 1_000_000 });
        this.restSim.addTee(0, { x: 0, y: 0 });
      }
      const played = restPlay(this.restSim, sc, 0, this.o.restTicks);
      this.simTicks += Math.abs(played);
      if (played < 0) return false;
    }
    this.goalHit = true;
    this.goalKind = 2;
    this.goalExtra = Math.round(f);
    return true;
  }

  setRejoin(route: Route | null, lo: number, hi: number): void {
    if (route === null) {
      this.rj = null;
      return;
    }
    const grid = new Map<number, number[]>();
    const N = route.states.length / FLAT_STRIDE;
    hi = Math.min(hi, N - 1);
    for (let i = Math.max(0, lo); i <= hi; i++) {
      const o = i * FLAT_STRIDE;
      const k = Math.trunc(route.states[o + FLAT_POS_X] / TILE) * 8192 + Math.trunc(route.states[o + FLAT_POS_Y] / TILE);
      let l = grid.get(k);
      if (l === undefined) grid.set(k, (l = []));
      l.push(i);
    }
    this.rj = { states: route.states, total: N - 1, grid };
  }

  private rejoinCost(): number {
    const rj = this.rj;
    if (rj === null) return -1;
    const c = this.core;
    const fz = this.sim.freezeTicksOf(0) > 0;
    const hp = c.hookState === HOOK_GRABBED || c.hookState === HOOK_FLYING;
    const tx = Math.trunc(c.pos.x / TILE);
    const ty = Math.trunc(c.pos.y / TILE);
    const st = rj.states;
    let best = -1;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const l = rj.grid.get((tx + ox) * 8192 + ty + oy);
        if (l === undefined) continue;
        for (const i of l) {
          const o = i * FLAT_STRIDE;
          if (Math.abs(st[o + FLAT_POS_X] - c.pos.x) > 12 || Math.abs(st[o + FLAT_POS_Y] - c.pos.y) > 12) continue;
          if (Math.abs(st[o + FLAT_VEL_X] - c.vel.x) > 1.5 || Math.abs(st[o + FLAT_VEL_Y] - c.vel.y) > 1.5) continue;
          if (st[o + FLAT_FREEZE_LEFT] > 0 !== fz) continue;
          const shs = st[o + FLAT_HOOK_STATE];
          if ((shs === HOOK_GRABBED || shs === HOOK_FLYING) !== hp) continue;
          const rem = rj.total - i;
          if (best < 0 || rem < best) {
            best = rem;
            this.rejoinIdx = i;
          }
        }
      }
    }
    return best;
  }

  private grow(need: number): void {
    if (need <= this.cap) return;
    const cap = Math.min(this.o.maxNodes + 1, Math.max(need, this.cap * 2, 4096));
    const pool = new Float64Array(cap * this.W);
    pool.set(this.pool);
    this.pool = pool;
    const g = new Int32Array(cap);
    g.set(this.gArr);
    this.gArr = g;
    const par = new Int32Array(cap);
    par.set(this.parent);
    this.parent = par;
    const code = new Int32Array(cap);
    code.set(this.codeArr);
    this.codeArr = code;
    const ticks = new Int16Array(cap);
    ticks.set(this.ticksArr);
    this.ticksArr = ticks;
    const depth = new Int32Array(cap);
    depth.set(this.depthArr);
    this.depthArr = depth;
    this.cap = cap;
  }

  private resync(): void {
    const sc = this.scratch;
    for (let j = 0; j < this.P; j++) {
      const o = j * FLAT_STRIDE;
      if (sc[o + FLAT_FREEZE_LEFT] > 0 || !grounded(this.col, sc[o + FLAT_POS_X], sc[o + FLAT_POS_Y])) return;
    }
    for (let j = 1; j < this.P; j++) sc.copyWithin(j * FLAT_STRIDE, 0, FLAT_STRIDE);
  }

  private playEdge(n: number, code: number, prevCode: number, depth: number, g: number): number {
    const { P, pool, sim, core, scratch, goalAt } = this;
    this.edgePen = 0;
    this.goalExtra = 0;
    this.goalHit = false;
    this.goalKind = 0;
    goalAt.fill(-1);
    const base = n * this.W;
    if (code === MACRO_WAIT) {

      const e = this.waitInp;
      let maxT = 0;
      for (let j = 0; j < P; j++) {
        sim.loadFlat(0, pool, base + j * FLAT_STRIDE);
        let still = 0;
        let t = 0;
        while (sim.freezeTicksOf(0) > 0) {
          if (t >= 300) return -1;
          sim.setInput(0, e);
          sim.step();
          this.simTicks++;
          t++;
          if (!sim.isAlive(0)) return -1;
          if (this.lyingInFreeze()) {
            if (++still > 10) return -1;
          } else still = 0;
        }
        maxT = Math.max(maxT, t);
        sim.saveFlat(0, scratch, j * FLAT_STRIDE);
      }

      if (maxT % 2 === 1) maxT++;
      for (let j = 0; j < P; j++) {
        sim.loadFlat(0, scratch, j * FLAT_STRIDE);
        const extra = maxT - (sim.tick - pool[base + j * FLAT_STRIDE + FLAT_TICK]);
        for (let t = 0; t < extra; t++) {
          sim.setInput(0, e);
          sim.step();
          this.simTicks++;
          if (!sim.isAlive(0)) return -1;
        }
        if (this.atGoal(sim)) goalAt[j] = maxT;
        sim.saveFlat(0, scratch, j * FLAT_STRIDE);
      }
      this.goalHit = goalAt.every((v) => v >= 0);
      if (!this.goalHit) this.segmentEnd();
      return maxT;
    }
    for (let j = 0; j < P; j++) {
      sim.loadFlat(0, pool, base + j * FLAT_STRIDE);
      const dly = this.o.roots ? 0 : this.o.late ? Math.min(j, MACRO_TICKS - 1) : this.delay(j, depth);
      let startIdle = core.hookState === HOOK_IDLE;
      for (let t = 0; t < MACRO_TICKS; t++) {
        let input: PlayerInput;
        if (t < dly) input = macroInput(prevCode, MACRO_TICKS - 1, false, this.prevInp);
        else {
          if (t === dly) startIdle = core.hookState === HOOK_IDLE;
          input = macroInput(code, t - dly, startIdle, this.inp);
        }
        sim.setInput(0, input);
        sim.step();
        this.simTicks++;
        if (!sim.isAlive(0)) return -1;
        const frozen = sim.freezeTicksOf(0) > 0;
        if (j === 0 && this.o.clearCost > 0 && !frozen) this.edgePen += this.clearancePenalty();
        if (goalAt[j] < 0 && goalReached(this.col, this.goal, core.pos.x, core.pos.y, core.vel.x, frozen)) {
          goalAt[j] = t + 1;

          if (P === 1) {
            sim.saveFlat(0, scratch, 0);
            this.goalHit = true;
            this.rejoinIdx = -1;
            return t + 1;
          }
        }
        if (P === 1 && this.rj !== null && t % 2 === 1) {
          const rc = this.rejoinCost();
          if (rc >= 0) {
            sim.saveFlat(0, scratch, 0);
            this.goalHit = true;
            this.goalKind = 1;
            this.goalExtra = rc;
            return t + 1;
          }
        }
      }

      if (sim.freezeTicksOf(0) > 140 && this.lyingInFreeze()) return -1;

      if (j === 0 && P > 1 && goalAt[0] < 0 && !this.mayEnd()) {
        if (!this.inRegion()) return -1;
        const b = this.best.get(this.keyOf());
        if (b !== undefined && b <= g + MACRO_TICKS + Math.round(this.edgePen)) return -1;
      }
      sim.saveFlat(0, scratch, j * FLAT_STRIDE);
    }

    const dev2 = this.o.dev * this.o.dev;
    for (let j = 1; j < P; j++) {
      const o = j * FLAT_STRIDE;
      const dx = scratch[o + FLAT_POS_X] - scratch[FLAT_POS_X];
      const dy = scratch[o + FLAT_POS_Y] - scratch[FLAT_POS_Y];
      if (dx * dx + dy * dy > dev2) return -1;
      const fj = scratch[o + FLAT_FREEZE_LEFT];
      const f0 = scratch[FLAT_FREEZE_LEFT];
      if (fj > 0 !== f0 > 0 && Math.abs(fj - f0) > 4) return -1;
    }
    this.goalHit = goalAt.every((v) => v >= 0);

    if (!this.goalHit && P > 1 && this.rj !== null) {
      sim.loadFlat(0, scratch, 0);
      const rc = this.rejoinCost();
      if (rc >= 0) {
        this.goalHit = true;
        this.goalKind = 1;
        this.goalExtra = rc;
      }
    }
    if (!this.goalHit) this.segmentEnd();
    return MACRO_TICKS;
  }

  search(starts: Float64Array, rootPrevCode: number, nodeBudget?: number): Route | null {
    return this.run(starts, rootPrevCode, nodeBudget, 1)[0] ?? null;
  }

  *searchGen(starts: Float64Array, rootPrevCode: number, nodeBudget?: number): Generator<number, Route | null, void> {
    return (yield* this.runGen(starts, rootPrevCode, nodeBudget, 1))[0] ?? null;
  }

  *searchManyGen(starts: Float64Array, rootPrevCode: number, nodeBudget: number, keep: number): Generator<number, Route[], void> {
    return yield* this.runGen(starts, rootPrevCode, nodeBudget, keep);
  }

  searchMany(starts: Float64Array, rootPrevCode: number, nodeBudget: number, keep: number): Route[] {
    return this.run(starts, rootPrevCode, nodeBudget, keep);
  }

  private run(starts: Float64Array, rootPrevCode: number, nodeBudget: number | undefined, keep: number): Route[] {
    const g = this.runGen(starts, rootPrevCode, nodeBudget, keep);
    for (;;) {
      const r = g.next();
      if (r.done === true) return r.value;
    }
  }

  private *runGen(starts: Float64Array, rootPrevCode: number, nodeBudget: number | undefined, keep: number): Generator<number, Route[], void> {
    const t0 = performance.now();
    const { P, o, heap } = this;
    const maxNodes = Math.min(o.maxNodes, nodeBudget ?? o.maxNodes);

    this.anchorCache.clear();
    this.best.clear();
    heap.clear();
    this.nNodes = 0;
    this.simTicks = 0;

    const goals: { node: number; parent: number; g: number; rejoin: number; segment: boolean }[] = [];
    let goalG = Infinity;
    let expanded = 0;
    let foundAtExp = 0;
    let stopped: Route["stopped"];
    const add = (par: number, g: number, code: number, ticks: number, depth: number, src: Float64Array): number => {
      if (this.nNodes >= maxNodes) return -1;
      const n = this.nNodes++;
      this.grow(n + 1);
      this.pool.set(src.subarray(0, this.W), n * this.W);
      this.gArr[n] = g;
      this.parent[n] = par;
      this.codeArr[n] = code;
      this.ticksArr[n] = ticks;
      this.depthArr[n] = depth;
      return n;
    };
    const root = add(-1, 0, rootPrevCode, 0, 0, starts);
    this.sim.loadFlat(0, this.pool, 0);
    this.best.set(this.keyOf(), 0);
    heap.push(root, o.w * this.h());
    const macros: number[] = [];
    let lastLog = t0;
    let iter = 0;
    let yielded = 0;
    while (heap.len > 0) {
      if ((++iter & 3) === 0) {
        yield this.simTicks - yielded;
        yielded = this.simTicks;
      }
      const fTop = heap.topKey();
      const n = heap.pop();
      const g = this.gArr[n];

      if (g + (fTop - g) / o.w >= goalG) continue;
      if (goals.length > 0 && expanded - foundAtExp >= o.improveExpansions) break;
      this.sim.loadFlat(0, this.pool, n * this.W);

      if ((this.best.get(this.keyOf()) ?? Infinity) < g) continue;
      if (expanded >= o.maxExpansions) {
        stopped = "expansions";
        break;
      }
      if (this.nNodes >= maxNodes - 100) {
        stopped = "nodes";
        break;
      }
      if ((expanded & 63) === 0 && performance.now() - t0 > o.timeLimitMs) {
        stopped = "time";
        break;
      }
      expanded++;
      const depth = this.depthArr[n];
      const prevCode = this.codeArr[n];
      this.macrosHere(macros);
      for (const code of macros) {
        const ticks = this.playEdge(n, code, prevCode, depth, g);
        if (ticks < 0) continue;
        if (this.o.late && P > 1) this.resync();

        this.sim.loadFlat(0, this.scratch, 0);
        if (!this.inRegion()) continue;
        const g2 = g + ticks + Math.round(this.edgePen);
        if (g2 >= goalG) continue;
        if (this.goalHit) {
          const gTot = g2 + this.goalExtra;
          if (gTot >= goalG) continue;

          const same = goals.findIndex((q) => q.parent === n);
          if (same >= 0 && goals[same].g <= gTot) continue;
          const m = add(n, gTot, code, ticks, depth + 1, this.scratch);
          if (m >= 0) {
            if (goals.length === 0) foundAtExp = expanded;
            if (same >= 0) goals.splice(same, 1);
            goals.push({ node: m, parent: n, g: gTot, rejoin: this.goalKind === 1 ? this.rejoinIdx : -1, segment: this.goalKind === 2 });
            goals.sort((a, b) => a.g - b.g);
            if (goals.length > keep) goals.length = keep;
            goalG = goals.length === keep ? goals[keep - 1].g : Infinity;
            if (o.log) console.error(`  goal ${gTot} ticks after ${((performance.now() - t0) / 1000).toFixed(1)} s, ${expanded} expanded`);
          }
          continue;
        }
        const k = this.keyOf();
        const b = this.best.get(k);
        if (b !== undefined && b <= g2) continue;
        this.best.set(k, g2);
        const hv = this.h();
        if (!Number.isFinite(hv)) continue;
        const m = add(n, g2, code, ticks, depth + 1, this.scratch);
        if (m < 0) continue;
        heap.push(m, g2 + o.w * hv);
      }
      if (o.log && performance.now() - lastLog > 5000) {
        lastLog = performance.now();
        console.error(`  ${((lastLog - t0) / 1000).toFixed(0)}s expanded ${expanded} nodes ${this.nNodes} open ${heap.len} best ${goalG === Infinity ? "-" : goalG}`);
      }
    }
    const ms = performance.now() - t0;
    this.totalSim += this.simTicks;
    this.totalMs += ms;
    this.runs++;
    if (goals.length === 0 && o.log) console.error(`  no path: ${(ms / 1000).toFixed(1)} s, expanded ${expanded}, nodes ${this.nNodes}, sim ticks ${this.simTicks}${stopped !== undefined ? `, stopped by ${stopped}` : ""}`);
    const routes: Route[] = [];
    for (const q of goals) {
      const chain: number[] = [];
      for (let n = q.node; n > 0; n = this.parent[n]) chain.push(n);
      chain.reverse();
      const codes = chain.map((n) => this.codeArr[n]);
      const edgeTicks = chain.map((n) => this.ticksArr[n]);
      const route = replayProgram(this.sim, starts, codes, edgeTicks);
      routes.push({ ...route, expanded, nodes: this.nNodes, ms, simTicks: this.simTicks, rejoinAt: q.rejoin >= 0 ? q.rejoin : undefined, segmentEnd: q.segment || undefined, stopped });

      yield route.ticks;
    }
    return routes;
  }
}

export function replayProgram(sim: SimWorld, start: Float64Array, codes: readonly number[], edgeTicks: readonly number[]): Pick<Route, "ticks" | "codes" | "edgeTicks" | "inputs" | "states" | "freezes"> {
  sim.loadFlat(0, start, 0);
  const core = sim.coreOf(0) as CharacterCore;
  const total = edgeTicks.reduce((a, b) => a + b, 0);
  const inputs: PlayerInput[] = [];
  const states = new Float64Array((total + 1) * FLAT_STRIDE);
  sim.saveFlat(0, states, 0);
  let ti = 0;
  let freezes = 0;
  let wasFrozen = sim.freezeTicksOf(0) > 0;
  for (let e = 0; e < codes.length; e++) {
    const startIdle = core.hookState === HOOK_IDLE;
    for (let t = 0; t < edgeTicks[e]; t++) {
      const inp = macroInput(codes[e], t, startIdle, emptyInput());
      inputs.push(inp);
      sim.setInput(0, inp);
      sim.step();
      ti++;
      sim.saveFlat(0, states, ti * FLAT_STRIDE);
      const fr = sim.freezeTicksOf(0) > 0;
      if (fr && !wasFrozen) freezes++;
      wasFrozen = fr;
    }
  }
  return { ticks: inputs.length, codes: [...codes], edgeTicks: [...edgeTicks], inputs, states, freezes };
}

export function describeRoute(states: Float64Array): string {
  const n = states.length / FLAT_STRIDE;
  const parts: string[] = [];
  let was = false;
  for (let i = 0; i < n; i++) {
    const o = i * FLAT_STRIDE;
    const fz = states[o + FLAT_FREEZE_LEFT] > 0;
    const at = `(${Math.trunc(states[o + FLAT_POS_X] / TILE)},${Math.trunc(states[o + FLAT_POS_Y] / TILE)})`;
    if (fz && !was) parts.push(`freeze t${i} at ${at}`);
    if (!fz && was) parts.push(`thaw t${i} at ${at}`);
    was = fz;
  }
  return `${parts.join(", ")}; ropes on ${ropeTiles(states).join(" ") || "none"}`;
}

export function ropeTiles(states: Float64Array): string[] {
  const n = states.length / FLAT_STRIDE;
  const ropes: string[] = [];
  for (let i = 1; i < n; i++) {
    const o = i * FLAT_STRIDE;
    if (states[o + FLAT_HOOK_STATE] !== HOOK_GRABBED || states[o - FLAT_STRIDE + FLAT_HOOK_STATE] === HOOK_GRABBED) continue;
    const tile = `(${Math.trunc(states[o + FLAT_HOOK_X] / TILE)},${Math.trunc(states[o + FLAT_HOOK_Y] / TILE)})`;
    if (!ropes.includes(tile)) ropes.push(tile);
  }
  return ropes;
}

export function trackDist(st: Float64Array, e: number, c: CharacterCore, frozen: boolean): number {
  const hsR = st[e + FLAT_HOOK_STATE] === HOOK_GRABBED ? 2 : st[e + FLAT_HOOK_STATE] === HOOK_FLYING ? 1 : 0;
  const hsP = c.hookState === HOOK_GRABBED ? 2 : c.hookState === HOOK_FLYING ? 1 : 0;
  return (
    Math.abs(st[e + FLAT_POS_X] - c.pos.x) +
    Math.abs(st[e + FLAT_POS_Y] - c.pos.y) +
    4 * (Math.abs(st[e + FLAT_VEL_X] - c.vel.x) + Math.abs(st[e + FLAT_VEL_Y] - c.vel.y)) +
    (hsR !== hsP ? 60 : 0) +
    (st[e + FLAT_FREEZE_LEFT] > 0 !== frozen ? 60 : 0)
  );
}

export type FollowOpts = {

  horizon: number;

  offRoute: number;
  nnMax: number;

  replanNodes: number;
  maxReplans: number;
  rejoin: boolean;

  aimThrows: boolean;

  keepTrack: boolean;

  lateCheck: boolean;
};

export const DEFAULT_FOLLOW: FollowOpts = { horizon: 30, offRoute: 120, nnMax: 40, replanNodes: 5000, maxReplans: 30, rejoin: true, aimThrows: false, keepTrack: false, lateCheck: false };

export function grabPoints(route: Route): Float64Array {
  const n = route.inputs.length;
  const st = route.states;
  const out = new Float64Array(n * 2).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (route.inputs[i].hook !== 1 || st[i * FLAT_STRIDE + FLAT_HOOK_STATE] !== HOOK_IDLE) continue;
    let j = i + 1;
    while (j <= n && st[j * FLAT_STRIDE + FLAT_HOOK_STATE] === HOOK_FLYING) j++;
    if (j > n || st[j * FLAT_STRIDE + FLAT_HOOK_STATE] !== HOOK_GRABBED) continue;
    out[2 * i] = st[j * FLAT_STRIDE + FLAT_HOOK_X];
    out[2 * i + 1] = st[j * FLAT_STRIDE + FLAT_HOOK_Y];
  }
  return out;
}

const AIM_SLACK_PX = 2;

function aimed(input: PlayerInput, x: number, y: number, gx: number, gy: number, out: PlayerInput): PlayerInput {
  Object.assign(out, input);
  out.targetX = Math.round(gx - x);
  out.targetY = Math.round(gy - y);
  if (out.targetX === 0 && out.targetY === 0) out.targetY = -1;
  return out;
}

export class RouteFollower {
  route: Route;

  clock = -1;
  replans = 0;
  rejoins = 0;
  replanMs = 0;
  maxDist = 0;
  private replanHold = -1;
  private readonly o: FollowOpts;
  private readonly roll: SimWorld;
  private readonly empty = emptyInput();
  private readonly aimBuf = emptyInput();

  private lastSent: PlayerInput = emptyInput();

  private grabs: Float64Array | null = null;
  readonly searcher: PathSearcher;

  constructor(searcher: PathSearcher, route: Route, opts: Partial<FollowOpts> = {}) {
    this.searcher = searcher;
    this.route = route;
    this.o = { ...DEFAULT_FOLLOW, ...opts };
    this.roll = new SimWorld(searcher.col, { respawnDelayTicks: 1_000_000 });
    this.roll.addTee(0, { x: 0, y: 0 });
    this.setRoute(route);
  }

  private setRoute(route: Route): void {
    this.route = route;
    this.grabs = this.o.aimThrows ? grabPoints(route) : null;
  }

  private inputAt(i: number, x: number, y: number, vx: number, vy: number, out: PlayerInput): PlayerInput {
    const input = this.route.inputs[i];
    const g = this.grabs;
    if (g === null || Number.isNaN(g[2 * i])) return input;
    const o = i * FLAT_STRIDE;
    const st = this.route.states;
    if (Math.abs(st[o + FLAT_POS_X] - x) <= AIM_SLACK_PX && Math.abs(st[o + FLAT_POS_Y] - y) <= AIM_SLACK_PX) return input;
    return aimed(input, x + vx / 2, y + vy / 2, g[2 * i], g[2 * i + 1], out);
  }

  private rollCost(pred: Float64Array, a: number, late: PlayerInput | null): number {
    const cur = this.route;
    const N = cur.states.length / FLAT_STRIDE;
    const roll = this.roll;
    const core = roll.coreOf(0) as CharacterCore;
    roll.loadFlat(0, pred, 0);
    let behind = 0;
    if (late !== null) {
      roll.setInput(0, late);
      roll.step();
      if (!roll.isAlive(0)) return Infinity;
      behind = 1;
    }
    let played = 0;
    let along = 0;
    for (let k = behind; k < this.o.horizon; k++) {
      const i = Math.min(a + k - behind, N - 2);
      roll.setInput(0, this.inputAt(i, core.pos.x, core.pos.y, core.vel.x, core.vel.y, this.aimBuf));
      roll.step();
      played++;
      if (!roll.isAlive(0)) return Infinity;
      if (k % 3 === 2) along += trackDist(cur.states, Math.min(a + played, N - 1) * FLAT_STRIDE, core, roll.freezeTicksOf(0) > 0);
      if (this.searcher.atGoal(roll)) break;
    }
    let c = trackDist(cur.states, Math.min(a + played, N - 1) * FLAT_STRIDE, core, roll.freezeTicksOf(0) > 0) + along / 10;
    if (roll.freezeTicksOf(0) > 0 && Math.abs(core.vel.x) < 0.3 && Math.abs(core.vel.y) < 0.6 && this.searcher.col.isFreeze(core.pos.x, core.pos.y)) c += 1000;
    return c;
  }

  decide(pred: Float64Array, now: number): PlayerInput {
    const cur = this.route;
    const N = cur.states.length / FLAT_STRIDE;
    const roll = this.roll;
    const core = roll.coreOf(0) as CharacterCore;
    const frozen = pred[FLAT_FREEZE_LEFT] > 0;
    const px = pred[FLAT_POS_X];
    const py = pred[FLAT_POS_Y];
    const pvx = pred[FLAT_VEL_X];
    const pvy = pred[FLAT_VEL_Y];
    let input: PlayerInput | null = null;

    let fallback: PlayerInput | null = null;
    let fallbackClock = -1;
    if (this.clock >= 0) {
      const lo = Math.max(0, this.clock - 1);
      const hi = Math.min(N - 2, this.clock + 1);
      let bestA = -1;
      let bestC = Infinity;
      for (const a of [this.clock, this.clock - 1, this.clock + 1]) {
        if (a < lo || a > hi) continue;
        let c = this.rollCost(pred, a, null);
        if (this.o.lateCheck && c < Infinity) c = Math.max(c, this.rollCost(pred, a, this.lastSent));
        if (c === Infinity) continue;
        c += 5 * Math.abs(a - this.clock);
        if (c < bestC) {
          bestC = c;
          bestA = a;
        }
      }
      if (bestA >= 0 && bestC <= this.o.offRoute) {
        input = this.inputAt(bestA, px, py, pvx, pvy, emptyInput());
        this.clock = bestA + 2;
        this.maxDist = Math.max(this.maxDist, bestC);
      } else if (bestA >= 0 && this.o.keepTrack) {
        fallback = this.inputAt(bestA, px, py, pvx, pvy, emptyInput());
        fallbackClock = bestA + 2;
      }
    } else {

      roll.loadFlat(0, pred, 0);
      let bi = -1;
      let bd = Infinity;
      for (let i = 0; i <= Math.min(N - 2, 40); i++) {
        const d = trackDist(cur.states, i * FLAT_STRIDE, core, frozen);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      if (bi >= 0 && bd <= this.o.nnMax) {
        input = this.inputAt(bi, px, py, pvx, pvy, emptyInput());
        this.clock = bi + 2;
        this.maxDist = Math.max(this.maxDist, bd);
      }
    }
    return (this.lastSent = this.choose(input, pred, now, fallback, fallbackClock));
  }

  private choose(input: PlayerInput | null, pred: Float64Array, now: number, fallback: PlayerInput | null, fallbackClock: number): PlayerInput {
    if (input !== null) return input;
    if (pred[FLAT_FREEZE_LEFT] > 0 || this.replans >= this.o.maxReplans || now < this.replanHold) {
      if (fallback !== null) {
        this.clock = fallbackClock;
        return fallback;
      }
      if (this.clock >= 0) this.clock += 2;
      return this.empty;
    }
    return this.replan(pred, now, fallback, fallbackClock);
  }

  private replan(pred: Float64Array, now: number, fallback: PlayerInput | null, fallbackClock: number): PlayerInput {
    this.replans++;
    const t0 = performance.now();
    const s = this.searcher;

    const starts = particleStarts(s.col, pred, s.o.particles, s.o.late ? 0 : 2);
    const cur = this.route;
    if (this.o.rejoin) s.setRejoin(cur, 0, cur.states.length / FLAT_STRIDE - 1);
    let r = s.search(starts, MACRO_ROOT, this.o.replanNodes);
    s.setRejoin(null, 0, 0);
    if (r !== null && r.rejoinAt !== undefined) {

      const ri = r.rejoinAt;
      const N0 = cur.states.length / FLAT_STRIDE;
      const inputs = [...r.inputs, ...cur.inputs.slice(ri)];
      const states = new Float64Array((inputs.length + 1) * FLAT_STRIDE);
      states.set(r.states.subarray(0, (r.inputs.length + 1) * FLAT_STRIDE), 0);
      states.set(cur.states.subarray((ri + 1) * FLAT_STRIDE, N0 * FLAT_STRIDE), (r.inputs.length + 1) * FLAT_STRIDE);
      r = { ...r, inputs, states, ticks: inputs.length };
      this.rejoins++;
    }
    this.replanMs += performance.now() - t0;
    if (r === null) {
      this.replanHold = now + 10;
      if (fallback !== null) {
        this.clock = fallbackClock;
        return fallback;
      }
      this.clock = -1;
      return this.empty;
    }
    this.setRoute(r);
    this.clock = 2;
    return this.inputAt(0, pred[FLAT_POS_X], pred[FLAT_POS_Y], pred[FLAT_VEL_X], pred[FLAT_VEL_Y], emptyInput());
  }
}

export type WalkResult = {

  arrive: number;
  died: boolean;
  replans: number;
  rejoins: number;
  freezes: number;
  maxDist: number;
  decisions: number;
  followMs: number;
  replanMs: number;

  end?: string;
};

export type LiveWalk = { lag: number; jitter: number; seed: number; maxTicks: number; onTick?: (world: SimWorld, t: number) => void };

export const PRED_OFFSETS = [-1, 0, 1, 2];
export function liveLoop(
  col: Collision,
  start: { x: number; y: number },
  walk: LiveWalk,
  decide: (preds: Float64Array, now: number) => PlayerInput,
  atGoal: (w: SimWorld) => boolean,
): { arrive: number; died: boolean; freezes: number; decisions: number; ms: number; end?: string } {
  const { lag, jitter, maxTicks } = walk;
  const world = new SimWorld(col, { respawnDelayTicks: 1_000_000 });
  world.addTee(0, start);
  const pred = new SimWorld(col, { respawnDelayTicks: 1_000_000 });
  pred.addTee(0, start);
  let s = walk.seed * 7919 + 17;
  const rnd = (): number => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  const pending: { at: number; input: PlayerInput }[] = [];
  const sentNom: { atNom: number; input: PlayerInput }[] = [];
  let held: PlayerInput = emptyInput();
  let heldNom: PlayerInput = emptyInput();
  let lastLanding = -1;
  let freezes = 0;
  let wasFrozen = false;
  let decisions = 0;
  let ms = 0;
  const snap = new Float64Array(FLAT_STRIDE);
  const preds = new Float64Array(FLAT_STRIDE * PRED_OFFSETS.length);
  const last = PRED_OFFSETS[PRED_OFFSETS.length - 1];
  for (let T = 0; T < maxTicks; T++) {
    if (T % 2 === 0) {
      decisions++;
      const tf = performance.now();
      world.saveFlat(0, snap, 0);
      pred.loadFlat(0, snap, 0);
      let h2 = heldNom;
      let pi = 0;
      while (pi < sentNom.length && sentNom[pi].atNom < T) pi++;
      for (let k = T; ; k++) {

        const off = k - T - lag;
        for (let n = 0; n < PRED_OFFSETS.length; n++) if (PRED_OFFSETS[n] === off || (PRED_OFFSETS[n] < -lag && k === T)) pred.saveFlat(0, preds, n * FLAT_STRIDE);
        if (off >= last) break;
        while (pi < sentNom.length && sentNom[pi].atNom <= k) h2 = sentNom[pi++].input;
        pred.setInput(0, h2);
        pred.step();
      }
      const input = decide(preds, T);
      ms += performance.now() - tf;
      let at = T + lag + (rnd() < jitter ? 1 : 0);
      if (at < lastLanding) at = lastLanding;
      lastLanding = at;
      pending.push({ at, input });
      sentNom.push({ atNom: T + lag, input });
    }
    while (pending.length > 0 && pending[0].at <= T) held = (pending.shift() as { input: PlayerInput }).input;
    while (sentNom.length > 0 && sentNom[0].atNom <= T) heldNom = (sentNom.shift() as { input: PlayerInput }).input;
    world.setInput(0, held);
    world.step();
    walk.onTick?.(world, T);
    if (!world.isAlive(0)) return { arrive: -1, died: true, freezes, decisions, ms };
    const fr = world.freezeTicksOf(0) > 0;
    if (fr && !wasFrozen) freezes++;
    wasFrozen = fr;
    if (atGoal(world)) return { arrive: T + 1, died: false, freezes, decisions, ms };
  }
  const c = world.coreOf(0) as CharacterCore;
  return { arrive: -1, died: false, freezes, decisions, ms, end: `(${(c.pos.x / TILE).toFixed(1)},${(c.pos.y / TILE).toFixed(1)}) v(${c.vel.x.toFixed(1)},${c.vel.y.toFixed(1)}) frozen ${world.freezeTicksOf(0)}` };
}

export function followRoute(searcher: PathSearcher, route: Route, start: { x: number; y: number }, walk: LiveWalk & { follow?: Partial<FollowOpts> }): WalkResult {
  const follower = new RouteFollower(searcher, route, walk.follow);
  const nominal = PRED_OFFSETS.indexOf(0) * FLAT_STRIDE;
  const r = liveLoop(searcher.col, start, walk, (preds, now) => follower.decide(preds.subarray(nominal, nominal + FLAT_STRIDE), now), (w) => searcher.atGoal(w));
  return {
    arrive: r.arrive,
    died: r.died,
    replans: follower.replans,
    rejoins: follower.rejoins,
    freezes: r.freezes,
    maxDist: follower.maxDist,
    decisions: r.decisions,
    followMs: r.ms - follower.replanMs,
    replanMs: follower.replanMs,
    end: r.end,
  };
}

export type SegmentOpts = {

  minDrop: number;

  lagOffsets: number[];
  nudges: [number, number][];

  candidates: number;

  jitterCopies: number;
  jitterRate: number;

  wideCandidates: number;
  wideImprove: number;

  lookahead: boolean;

  libraryMisses: number;

  libraryMaxMisses: number;

  libraryAsk: number;

  librarySpeed: boolean;

  restTicks: number;

  fastTier: boolean;

  libraryCut: boolean;

  recheck: boolean;
  recheckSlack: number;

  libraryTierBonus: number;

  settleTicks: number;

  libraryWay: boolean;

  libraryReach: number;

  libraryAll: number;

  adoptMisses: number;

  rollAhead: boolean;

  coast: "last" | "brake" | "smart";

  copiesSearch: boolean;

  nodes: number;
  thinNodes: number;

  onward: boolean;
  onwardNodes: number;

  fallback: "segment" | "way";

  grace: number;

  holdTicks: number;
  maxStalls: number;

  maxGrowth: number;

  sliceWork: number;
  planWork: number;
  sliceMs: number;
  planMs: number;
  maxRedo: number;
};

export const DEFAULT_SEGMENT: SegmentOpts = {

  minDrop: 20,
  lagOffsets: [-1, 1, 2],
  nudges: [
    [-6, 0],
    [6, 0],
    [0, -4],
    [0, 4],
  ],
  candidates: 8,
  wideCandidates: 0,
  wideImprove: 1500,
  lookahead: true,
  rollAhead: true,
  adoptMisses: 3,

  libraryMisses: 3,
  libraryMaxMisses: 15,
  libraryAsk: 48,
  librarySpeed: false,
  restTicks: 30,
  fastTier: true,
  libraryCut: true,
  settleTicks: 60,
  libraryTierBonus: Infinity,
  recheck: false,
  recheckSlack: 1,
  libraryWay: true,
  libraryReach: 80,
  libraryAll: 1,
  coast: "smart",
  jitterCopies: 8,
  jitterRate: 0.3,
  copiesSearch: false,
  nodes: 20_000,
  thinNodes: 20_000,
  onward: true,
  onwardNodes: 50_000,
  fallback: "segment",
  grace: 20,
  holdTicks: 10,
  maxStalls: 6,
  maxGrowth: 8,
  sliceWork: 6000,
  planWork: 200_000,
  sliceMs: 30,
  planMs: 1500,
  maxRedo: 3,
};

export function segmentCopies(o: SegmentOpts): number {
  return 1 + o.lagOffsets.length + o.nudges.length;
}

export const walkerStats = { searchDecisions: 0, maxDecisionMs: 0, sumDecisionMs: 0, capped: 0, library: 0, fast: 0, ahead: 0, plans: 0, libQueries: 0, libHits: 0, libEmpty: 0, libFailed: 0, waits: 0, rechecks: 0, switches: 0, maxRecheckMs: 0, maxStepCpuMs: 0, maxSliceCpuMs: 0 };

export const libraryLog: { sink: ((rec: Record<string, number | string | boolean>) => void) | null } = { sink: null };
export function resetWalkerStats(): void {
  walkerStats.searchDecisions = 0;
  walkerStats.maxDecisionMs = 0;
  walkerStats.maxStepCpuMs = 0;
  walkerStats.maxSliceCpuMs = 0;
  walkerStats.sumDecisionMs = 0;
  walkerStats.capped = 0;
  walkerStats.library = 0;
  walkerStats.fast = 0;
  walkerStats.ahead = 0;
  walkerStats.plans = 0;
  walkerStats.libQueries = 0;
  walkerStats.libHits = 0;
  walkerStats.libEmpty = 0;
  walkerStats.libFailed = 0;
  walkerStats.waits = 0;
  walkerStats.rechecks = 0;
  walkerStats.switches = 0;
  walkerStats.maxRecheckMs = 0;
}

type PlanEnd = { pick: Route | null; target: number; frozenAtStart: boolean; ahead: number; fast?: boolean };

const NOMINAL = PRED_OFFSETS.indexOf(0) * FLAT_STRIDE;

const HOLD_EXTRA = 48;

const WALKER_ANCHORS = 3;

const WALKER_W = 1.3;

const WALKER_IMPROVE = 300;

const MAX_PLAN_TICKS = 40;

const ANY_END = 1e9;

const END_ENTRY = -2;

const FAST_MORE_MISSES = 1;
export const FAST_MAX_MISSES = 2;

const ALIGN_TRIES = [0, -1, 1];

const ADOPT_TRIES = [0, -1, 1];
const ADOPT_WINDOW = 2;

const ONWARD_TRIES = 2;

function lateMix(j: number, k: number): number {
  let x = (Math.imul(j + 1, 2654435761) + Math.imul(k, 40503)) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  return x;
}
export function lateHash(j: number, k: number): number {
  return lateMix(j, k) / 4294967296;
}
export function lateHashU(j: number, k: number): number {
  return (lateMix(j, k) >>> 0) / 4294967296;
}

export class SegmentWalker {

  readonly thin: PathSearcher;
  readonly copies: PathSearcher | null;
  private readonly onward: PathSearcher | null;
  private readonly wide: PathSearcher | null;
  private readonly o: SegmentOpts;
  private readonly roll: SimWorld;
  private restSim: SimWorld | null = null;
  private readonly restBuf = new Float64Array(FLAT_STRIDE);

  private tape: PlayerInput[] | null = null;
  private rootAt = 0;
  private target = -1;
  private last: PlayerInput = emptyInput();
  private holdUntil = -1;

  private growth = 1;
  private stallRun = 0;
  searches = 0;

  private pending: Generator<number, PlanEnd, void> | null = null;

  private pendingLive = true;
  private pendingAt = 0;

  private pendingRolled = 0;
  private pendingFresh = true;
  private lagNow = 0;
  private decideAt = 0;
  private planTicks = 12;
  private pendingFrom = 0;
  private next: { tape: PlayerInput[]; target: number } | null = null;
  private lookTried: PlayerInput[] | null = null;

  private tapeBase = -1;

  private lookSawCands = false;
  private lookAsked = false;
  private tapeSeen: PlayerInput[] | null = null;

  private endIdx = -1;
  private playedTicks = 0;

  looks = 0;
  lookUsed = 0;
  private pendingWork = 0;
  private pendingMs = 0;
  private redo = 0;

  private work = 0;

  private waitThaw = false;
  private readonly brake: PlayerInput = emptyInput();
  private readonly stepLeft: PlayerInput = { ...emptyInput(), direction: -1 };
  private readonly stepRight: PlayerInput = { ...emptyInput(), direction: 1 };

  private holdIn: PlayerInput = emptyInput();

  capped = false;
  private readonly clock: () => number;

  private readonly library: SegmentLibrary | null;

  entryZone: readonly TileBox[] | null = null;

  private fastTape: PlayerInput[] | null = null;

  crowded = false;

  cacheHits = 0;

  trace: ((msg: string) => void) | null = null;

  verified = 0;
  robust = 0;
  thinFound = 0;

  deadEnds = 0;

  realigned = 0;

  widened = 0;

  get onPlan(): boolean {
    return this.tape !== null && !this.waitThaw && this.stallRun === 0 && (this.pending === null || !this.pendingLive);
  }

  get stuck(): boolean {
    return this.stallRun >= this.o.maxStalls;
  }
  stalls = 0;
  searchMs = 0;

  constructor(thin: PathSearcher, copies: PathSearcher | null, opts: Partial<SegmentOpts> = {}, clock: () => number = () => performance.now(), library: SegmentLibrary | null = null) {
    this.clock = clock;
    this.library = library;
    this.o = { ...DEFAULT_SEGMENT, ...opts };
    if (copies !== null && (!copies.o.roots || copies.o.particles !== segmentCopies(this.o))) throw new Error(`copies searcher: roots copies, ${segmentCopies(this.o)} particles`);
    if (thin.o.particles !== 1) throw new Error("thin searcher: one copy");
    this.thin = thin;
    this.copies = copies;

    this.onward = this.o.onward ? thin.withOpts({ w: 2.5, maxNodes: this.o.onwardNodes * this.o.maxGrowth, maxExpansions: 1e9, improveExpansions: 0, timeLimitMs: 1e9, particles: 1, late: false, roots: false, clearPx: 0, clearCost: 0 }) : null;
    this.wide = this.o.wideCandidates > 0 ? thin.withOpts({ improveExpansions: this.o.wideImprove }) : null;
    this.roll = new SimWorld(thin.col, { respawnDelayTicks: 1_000_000 });
    this.roll.addTee(0, { x: 0, y: 0 });
  }

  private takeWork(): number {
    const w = this.work;
    this.work = 0;
    return w;
  }

  decide(preds: Float64Array, now: number, lag: number): PlayerInput {
    return resolveAim(this.decideRaw(preds, now, lag), preds[NOMINAL + FLAT_POS_X], preds[NOMINAL + FLAT_POS_Y]);
  }

  private decideRaw(preds: Float64Array, now: number, lag: number): PlayerInput {
    const at = now + lag;
    this.lagNow = lag;
    this.decideAt = this.clock();
    if (this.waitThaw) {
      if (preds[NOMINAL + FLAT_FREEZE_LEFT] > 0) return this.last;
      this.waitThaw = false;
    }
    if (this.pending !== null && this.pendingLive) return this.slice(preds, at, now);
    if (this.tape !== null) {
      const r = this.follow(preds, at);
      if (r !== null) return r;

      if (this.atEnd(preds)) {
        if (this.next !== null) {
          const k = this.adopt(preds, at, 0);
          if (k >= 0) return (this.last = (this.tape as PlayerInput[])[k]);
        }
        if (this.pending !== null && this.o.coast !== "last") {

          this.pending = null;
        } else if (this.pending !== null) {
          this.tape = null;
          this.pendingLive = true;
          this.pendingAt = at;
          this.pendingFrom = now;
          this.pendingMs = 0;
          this.pendingRolled = 0;
          this.pendingFresh = false;
          return this.slice(preds, at, now);
        }
      }
      this.trace?.(`program lost at ${now} (tick ${at - this.rootAt} of ${this.tape.length})`);
      this.dropLook();
    }
    if (now < this.holdUntil || this.stallRun >= this.o.maxStalls) return this.last;
    this.tape = null;
    this.startLive(preds, at, now);
    return this.slice(preds, at, now);
  }

  private follow(preds: Float64Array, at: number): PlayerInput | null {
    const tape = this.tape as PlayerInput[];
    const i = at - this.rootAt;
    if (i < -1) return this.hold();

    const upto = tape.length + (this.o.lookahead && this.target >= 0 ? this.o.grace : 0);

    if (this.next !== null && i >= this.endIdx && i <= this.endIdx + ADOPT_WINDOW) {
      const k = this.adopt(preds, at, i - this.endIdx);
      if (k >= 0) return (this.last = (this.tape as PlayerInput[])[k]);
    }

    for (const d of ALIGN_TRIES) {
      const k = i + d;
      if (k < 0 || k >= upto || !this.works(preds, k)) continue;
      if (d !== 0) {
        this.rootAt = at - k;
        this.realigned++;
      }
      if (this.o.recheck && k < tape.length - 2 && this.recheck(preds, at, k)) return this.tape === null ? null : (this.last = this.tape[0]);

      if (this.pending !== null) this.advanceLook();
      else this.startLook(preds, k);
      return (this.last = tape[Math.min(k, tape.length - 1)]);
    }
    return null;
  }

  private recheck(preds: Float64Array, at: number, k: number): boolean {
    const t0 = this.clock();
    const work = this.work;
    try {
      return this.recheckInner(preds, at, k);
    } finally {

      this.work = work;
      walkerStats.maxRecheckMs = Math.max(walkerStats.maxRecheckMs, this.clock() - t0);
    }
  }

  private recheckInner(preds: Float64Array, at: number, k: number): boolean {
    const tape = this.tape as PlayerInput[];
    const P = segmentCopies(this.o);
    const starts = this.copyStarts(preds);
    const minEnd = this.followEnd();
    walkerStats.rechecks++;
    let missed = 0;
    for (let j = 1; j < P; j++) if (!this.plays(tape, k, starts, j * FLAT_STRIDE, this.target, true, -1, undefined, 0, minEnd)) missed++;
    for (let j = 0; j < this.o.jitterCopies; j++) if (!this.plays(tape, k, starts, 0, this.target, true, j, undefined, 0, minEnd)) missed++;
    if (this.tapeSeen !== tape) {
      this.tapeSeen = tape;
      this.tapeBase = missed;
      return false;
    }
    if (missed <= this.tapeBase + this.o.recheckSlack) {
      this.tapeBase = Math.min(this.tapeBase, missed);
      return false;
    }
    const g = this.libraryPick(starts, missed - 1);
    let r = g.next();
    while (r.done !== true) r = g.next();
    if (r.value === null) {

      this.tapeBase = missed - this.o.recheckSlack;
      return false;
    }
    walkerStats.switches++;
    this.trace?.(`switched at tape tick ${k}: ${missed} copies miss the program (${this.tapeBase} at first), the library's ${r.value.pick.inputs.length}-tick program for the state instead`);
    this.dropLook();
    this.lookTried = null;
    this.tape = r.value.pick.inputs;
    this.target = r.value.target;
    this.rootAt = at;
    this.tapeSeen = null;
    return true;
  }

  private startLive(preds: Float64Array, at: number, now: number): void {
    this.searches++;
    walkerStats.plans++;
    this.trace?.(`plan begun at ${at - this.lagNow} (tee ${preds[NOMINAL + FLAT_POS_X].toFixed(0)},${preds[NOMINAL + FLAT_POS_Y].toFixed(0)} v ${preds[NOMINAL + FLAT_VEL_X].toFixed(1)},${preds[NOMINAL + FLAT_VEL_Y].toFixed(1)} frozen ${preds[NOMINAL + FLAT_FREEZE_LEFT]}) ahead ${this.planTicks}`);
    const starts = this.copyStarts(preds);
    const ahead = this.o.rollAhead ? this.planTicks : 0;
    if (this.o.coast === "smart") this.holdIn = this.chooseHold(starts, Math.max(ahead, 12));
    if (this.o.coast !== "last") this.last = this.hold();
    this.pending = this.planGen(starts, ahead > 0 ? this.rolled(starts, ahead) : starts, ahead);
    this.pendingLive = true;
    this.pendingAt = at;
    this.pendingRolled = ahead;
    this.pendingFresh = true;
    this.pendingFrom = now;
    this.pendingWork = 0;
    this.pendingMs = 0;
  }

  private hold(): PlayerInput {
    return this.o.coast === "last" ? this.last : this.o.coast === "brake" ? this.brake : this.holdIn;
  }

  private chooseHold(starts: Float64Array, ticks: number): PlayerInput {
    const cands: PlayerInput[] = [this.brake, this.last, this.stepLeft, this.stepRight];
    let best = this.brake;
    let bestScore = Infinity;
    for (const c of cands) {
      let worst = 0;
      for (let j = 0; j < PRED_OFFSETS.length; j++) worst = Math.max(worst, this.holdScore(starts, j * FLAT_STRIDE, c, ticks + HOLD_EXTRA));
      if (worst < bestScore) {
        bestScore = worst;
        best = c;
      }
    }
    return best;
  }

  private holdScore(st: Float64Array, off: number, input: PlayerInput, ticks: number): number {
    const roll = this.roll;
    const core = roll.coreOf(0) as CharacterCore;
    roll.loadFlat(0, st, off);
    for (let t = 0; t < ticks; t++) {
      if ((t & 1) === 0) roll.setInput(0, resolveAim(input, core.pos.x, core.pos.y));
      roll.step();
      if (!roll.isAlive(0)) return 1e6;
      if (roll.freezeTicksOf(0) > 0) return 1e5 - t;
    }
    const s = this.thin;
    return (grounded(s.col, core.pos.x, core.pos.y) ? 0 : 200) + 5 * Math.hypot(core.vel.x, core.vel.y);
  }

  private rolled(starts: Float64Array, ticks: number): Float64Array {
    const roll = this.roll;
    const core = roll.coreOf(0) as CharacterCore;
    const out = starts.slice();
    const hold = this.hold();
    for (let o = 0; o < out.length; o += FLAT_STRIDE) {
      roll.loadFlat(0, starts, o);
      let alive = true;
      for (let t = 0; t < ticks && alive; t++) {
        if ((t & 1) === 0) roll.setInput(0, resolveAim(hold, core.pos.x, core.pos.y));
        roll.step();
        alive = roll.isAlive(0);
      }
      if (alive) roll.saveFlat(0, out, o);
    }
    return out;
  }

  private runSlice(): "more" | "capped" | PlanEnd {
    const t0 = this.clock();
    const cpu0 = process.cpuUsage();
    const r = this.runSliceInner();
    const cpu = process.cpuUsage(cpu0);
    if ((cpu.user + cpu.system) / 1000 > walkerStats.maxSliceCpuMs) walkerStats.maxSliceCpuMs = (cpu.user + cpu.system) / 1000;
    const took = this.clock() - t0;
    walkerStats.searchDecisions++;
    walkerStats.sumDecisionMs += took;
    if (took > walkerStats.maxDecisionMs) walkerStats.maxDecisionMs = took;
    return r;
  }

  private runSliceInner(): "more" | "capped" | PlanEnd {
    const plan = this.pending as Generator<number, PlanEnd, void>;
    const t0 = this.clock();
    let spent = 0;
    for (;;) {
      const r = plan.next();
      if (r.done === true) {
        const used = this.clock() - t0;
        this.searchMs += used;
        this.pendingMs += used;
        return r.value;
      }
      spent += r.value;
      this.pendingWork += r.value;
      const used = this.clock() - t0;
      if (this.pendingWork > this.o.planWork || this.pendingMs + used > this.o.planMs) {
        this.searchMs += used;
        walkerStats.capped++;
        return "capped";
      }

      if (spent >= this.o.sliceWork || this.clock() - this.decideAt > this.o.sliceMs) {
        this.searchMs += used;
        this.pendingMs += used;
        return "more";
      }
    }
  }

  private slice(preds: Float64Array, at: number, now: number): PlayerInput {
    const r = this.runSlice();
    if (r === "capped") {
      this.pending = null;
      this.capped = true;
      return this.hold();
    }
    if (r === "more") {
      walkerStats.waits++;
      return this.hold();
    }
    this.pending = null;
    this.trace?.(`plan done at ${now}: ${r.pick === null ? "nothing" : `${r.pick.inputs.length} ticks, ${this.pendingWork} work`}, ahead ${r.ahead}`);
    if (this.pendingFresh) this.planTicks = Math.max(0, Math.min(MAX_PLAN_TICKS, now - this.pendingFrom + 2));
    this.installed(r.pick, r.target, r.frozenAtStart, this.pendingAt + r.ahead, now);
    this.fastTape = r.fast === true ? this.tape : null;
    return this.landed(preds, at);
  }

  private landed(preds: Float64Array, at: number): PlayerInput {
    if (this.tape === null) {
      this.redo = 0;
      return this.last;
    }
    const r = this.follow(preds, at);
    if (r !== null) {
      this.redo = 0;
      return r;
    }
    this.rootAt = at;
    if (this.works(preds, 0)) {
      this.redo = 0;
      return (this.last = this.tape[0]);
    }
    this.tape = null;
    if (++this.redo > this.o.maxRedo) {
      this.capped = true;
      return this.last;
    }
    this.startLive(preds, at, at - this.lagNow);
    return this.hold();
  }

  private startLook(preds: Float64Array, k: number): void {
    const tape = this.tape as PlayerInput[];
    if (!this.o.lookahead || this.target < 0 || this.next !== null || this.lookTried === tape) return;
    this.lookTried = tape;
    const P = segmentCopies(this.o);
    const starts = this.copyStarts(preds);
    const ends = new Float64Array(P * FLAT_STRIDE);
    for (let j = 0; j < P; j++) {

      if (!this.plays(tape, k, starts, j * FLAT_STRIDE, ANY_END, true, -1, ends, j * FLAT_STRIDE, tape.length - 1)) {
        if (j === 0) {
          return;
        }
        ends.copyWithin(j * FLAT_STRIDE, 0, FLAT_STRIDE);
      } else if (j === 0) this.endIdx = k + this.playedTicks;
    }
    this.takeWork();
    this.looks++;
    this.pending = this.planGen(ends, ends, 0);
    this.pendingLive = false;
    this.pendingWork = 0;
    this.pendingMs = 0;
    this.advanceLook();
  }

  private advanceLook(): void {
    const r = this.runSlice();
    if (r === "more") return;
    this.pending = null;
    if (r === "capped" || r.pick === null || r.pick.inputs.length === 0) return;
    this.next = { tape: r.pick.inputs, target: r.pick.segmentEnd === true ? r.target : -1 };
    this.trace?.(`segment searched ahead: ${r.pick.inputs.length} ticks (${this.pendingWork} work), its start at tape tick ${this.endIdx}`);
  }

  private dropLook(): void {
    if (this.pending !== null && !this.pendingLive) this.pending = null;
    this.next = null;
  }

  private atEnd(preds: Float64Array): boolean {
    this.roll.loadFlat(0, preds, NOMINAL);
    return this.ended(this.target);
  }

  private adopt(preds: Float64Array, at: number, late: number): number {
    const nx = this.next as { tape: PlayerInput[]; target: number };
    this.next = null;
    const starts = this.copyStarts(preds);
    const P = segmentCopies(this.o);
    const minEnd = nx.target >= 0 ? nx.tape.length - 1 : 0;
    for (const d of ADOPT_TRIES) {
      const k = late + d;
      if (k < 0 || k >= nx.tape.length) continue;

      let ok = this.plays(nx.tape, k, preds, NOMINAL, nx.target, false, -1, undefined, 0, minEnd);
      let misses = 0;
      for (let j = 1; j < P && ok; j++) if (!this.plays(nx.tape, k, starts, j * FLAT_STRIDE, nx.target, true, -1, undefined, 0, minEnd)) ok = ++misses <= this.o.adoptMisses;
      for (let j = 0; j < this.o.jitterCopies && ok; j++) if (!this.plays(nx.tape, k, starts, 0, nx.target, true, j, undefined, 0, minEnd)) ok = ++misses <= this.o.adoptMisses;
      if (!ok) continue;
      this.tape = nx.tape;
      this.target = nx.target;
      this.rootAt = at - k;
      this.lookUsed++;
      walkerStats.ahead++;
      this.trace?.(`segment searched ahead taken at tape tick ${late} + ${d}`);
      return k;
    }
    return -1;
  }

  private ended(target: number): boolean {
    const s = this.thin;
    if (target === END_ENTRY) return this.entered();
    if (s.atGoal(this.roll)) return true;
    if (target < 0 || this.roll.freezeTicksOf(0) > 0) return false;
    const c = this.roll.coreOf(0) as CharacterCore;
    if (!(grounded(s.col, c.pos.x, c.pos.y) && s.fieldAt(c.pos.x, c.pos.y) <= target)) return false;
    if (this.o.restTicks === 0) return true;
    if (this.restSim === null) {
      this.restSim = new SimWorld(s.col, { respawnDelayTicks: 1_000_000 });
      this.restSim.addTee(0, { x: 0, y: 0 });
    }
    this.roll.saveFlat(0, this.restBuf, 0);
    const played = restPlay(this.restSim, this.restBuf, 0, this.o.restTicks);
    this.work += Math.abs(played);
    return played >= 0;
  }

  private entered(): boolean {
    const c = this.roll.coreOf(0) as CharacterCore;
    return this.roll.isAlive(0) && this.inEntry(c.pos.x, c.pos.y);
  }

  private inEntry(x: number, y: number): boolean {
    const zone = this.entryZone;
    if (zone === null) return false;
    const tx = Math.trunc(x / TILE);
    const ty = Math.trunc(y / TILE);
    for (const b of zone) if (tx >= b.x0 && tx <= b.x1 && ty >= b.y0 && ty <= b.y1) return true;
    return false;
  }

  private plays(tape: readonly PlayerInput[], i: number, st: Float64Array, off: number, target: number, atStart: boolean, jitter = -1, out?: Float64Array, outOff = 0, minEnd = 0, uniform = false): boolean {
    const roll = this.roll;
    const core = roll.coreOf(0) as CharacterCore;
    roll.loadFlat(0, st, off);
    this.playedTicks = 0;
    if (i >= minEnd && this.ended(target)) {
      if (out !== undefined) roll.saveFlat(0, out, outOff);
      return atStart;
    }
    let still = 0;

    let aimX = core.pos.x;
    let aimY = core.pos.y;
    let prevAimX = aimX;
    let prevAimY = aimY;
    for (let k = i; k < tape.length + this.o.grace; k++) {
      this.work++;
      if (((k - i) & 1) === 0) {
        prevAimX = aimX;
        prevAimY = aimY;
        aimX = core.pos.x;
        aimY = core.pos.y;
      }
      const late = jitter >= 0 && k > 0 && k % 2 === 0 && k < tape.length && (uniform ? lateHashU(jitter, k) : lateHash(jitter, k)) < this.o.jitterRate;
      const held = k - ((k - i) & 1);

      const before = late && ((k - i) & 1) === 0;
      roll.setInput(0, resolveAim(tape[Math.min(late ? k - 1 : held, tape.length - 1)], before ? prevAimX : aimX, before ? prevAimY : aimY));
      roll.step();
      if (!roll.isAlive(0)) return false;
      if (roll.freezeTicksOf(0) > 0 && Math.abs(core.vel.x) < 0.3 && Math.abs(core.vel.y) < 0.6 && this.thin.col.isFreeze(core.pos.x, core.pos.y)) {
        if (++still > 10) return false;
      } else still = 0;
      if (k >= minEnd && this.ended(target)) {
        this.playedTicks = k - i + 1;
        if (out !== undefined) roll.saveFlat(0, out, outOff);
        return true;
      }
    }
    return false;
  }

  private works(preds: Float64Array, i: number): boolean {
    const tape = this.tape as PlayerInput[];
    if (tape === this.fastTape && !this.inEntry(preds[NOMINAL + FLAT_POS_X], preds[NOMINAL + FLAT_POS_Y])) return this.plays(tape, i, preds, NOMINAL, END_ENTRY, false);
    return this.plays(tape, i, preds, NOMINAL, this.target, false, -1, undefined, 0, this.followEnd());
  }

  private followEnd(): number {
    return this.o.lookahead && this.target >= 0 && this.tape !== null ? this.tape.length - 1 : 0;
  }

  private copyStarts(preds: Float64Array): Float64Array {
    const col = this.thin.col;
    const nominal = PRED_OFFSETS.indexOf(0) * FLAT_STRIDE;
    const starts = new Float64Array(segmentCopies(this.o) * FLAT_STRIDE);
    starts.set(preds.subarray(nominal, nominal + FLAT_STRIDE), 0);
    let j = 1;
    for (const off of this.o.lagOffsets) {
      const n = PRED_OFFSETS.indexOf(off);
      if (n < 0) throw new Error(`lag offset ${off} not predicted`);
      starts.set(preds.subarray(n * FLAT_STRIDE, (n + 1) * FLAT_STRIDE), j++ * FLAT_STRIDE);
    }
    for (const [dx, dy] of this.o.nudges) {
      const o = j++ * FLAT_STRIDE;
      starts.set(preds.subarray(nominal, nominal + FLAT_STRIDE), o);
      const x = preds[nominal + FLAT_POS_X] + dx;
      const y = preds[nominal + FLAT_POS_Y] + dy;

      if (col.isSolid(x - HALF, y - HALF) || col.isSolid(x + HALF, y - HALF) || col.isSolid(x - HALF, y + HALF) || col.isSolid(x + HALF, y + HALF)) continue;
      starts[o + FLAT_POS_X] = x;
      starts[o + FLAT_POS_Y] = y;
      starts[o + FLAT_PREV_X] += dx;
      starts[o + FLAT_PREV_Y] += dy;
    }
    return starts;
  }

  seedFrom(states: Float64Array, inputs: readonly PlayerInput[]): { added: number; grades: number[] } {
    const lib = this.library;
    const out = { added: 0, grades: [] as number[] };
    if (lib === null) return out;
    const S = FLAT_STRIDE;
    const N = Math.min(states.length / S, inputs.length);
    const Pc = segmentCopies(this.o);
    let i = 2;
    while (i + 2 < N) {
      const field = this.thin.fieldAt(states[i * S + FLAT_POS_X], states[i * S + FLAT_POS_Y]);
      const target = field - this.o.minDrop;
      if (target < 0) break;
      let j = i + 1;
      for (; j < N; j++) {
        this.roll.loadFlat(0, states, j * S);
        if (this.ended(target)) break;
      }
      if (j >= N) break;
      const preds = new Float64Array(S * PRED_OFFSETS.length);
      for (let n = 0; n < PRED_OFFSETS.length; n++) preds.set(states.subarray((i + PRED_OFFSETS[n]) * S, (i + PRED_OFFSETS[n] + 1) * S), n * S);
      const starts = this.copyStarts(preds);

      let graded = -1;
      for (const shift of [0, 1]) {
        const tape: PlayerInput[] = [];
        for (let k = 0; k < j - i; k++) tape.push({ ...inputs[Math.min(i + k - (k & 1) + (shift === 1 ? 2 * (k & 1) : 0), N - 1)] });
        if (!this.plays(tape, 0, starts, 0, target, false)) continue;
        let missed = 0;
        for (let c = 1; c < Pc; c++) if (!this.plays(tape, 0, starts, c * S, target, true)) missed++;
        for (let c = 0; c < this.o.jitterCopies; c++) if (!this.plays(tape, 0, starts, 0, target, true, c)) missed++;
        if (graded < 0 || missed < graded) {
          graded = missed;
          if (missed <= this.o.libraryMaxMisses && lib.add(starts, 0, tape, missed, this.trajectoryOf(starts, tape))) out.added++;
        }
        if (missed === 0) break;
      }
      out.grades.push(graded);
      i = j;
    }
    return out;
  }

  private *planGen(starts0: Float64Array, starts1: Float64Array, ahead: number): Generator<number, PlanEnd, void> {
    const frozenAtStart = starts0[FLAT_FREEZE_LEFT] > 0;

    const tries: { starts: Float64Array; ahead: number; settled?: boolean }[] = [{ starts: starts0, ahead: 0 }];
    if (ahead > 0) tries.push({ starts: starts1, ahead });
    if (!frozenAtStart) {
      const down = this.settled(starts0);
      if (down !== null && down.ticks > Math.max(ahead, 3)) tries.push({ starts: down.starts, ahead: down.ticks, settled: true });
    }

    const tiers = this.library !== null && this.library.secondary !== null && this.o.libraryTierBonus === Infinity ? [1, 2] : [0];

    if (this.library !== null && this.library.fast !== null && this.o.fastTier && this.entryZone !== null && !this.crowded) tiers.unshift(3);
    this.lookSawCands = false;
    this.lookAsked = false;
    for (const tier of tiers) {
      for (const t of tries) {

        if (tier === 3 && t.settled === true) continue;

        if (tier === 3 && (!this.pendingLive || this.searches > 1)) continue;
        const got = yield* this.libraryPick(t.starts, Infinity, tier);
        if (got !== null) {
          walkerStats.libQueries++;
          walkerStats.libHits++;
          walkerStats.library++;
          if (tier === 3) walkerStats.fast++;
          this.cacheHits++;
          return { ...got, frozenAtStart, ahead: t.ahead, fast: tier === 3 };
        }
      }
    }
    if (this.lookAsked) {
      walkerStats.libQueries++;
      if (this.lookSawCands) walkerStats.libFailed++;
      else walkerStats.libEmpty++;
    }
    const found = yield* this.pickGen(starts1);
    return { ...found, frozenAtStart, ahead };
  }

  private settled(starts: Float64Array): { ticks: number; starts: Float64Array } | null {
    if (this.o.settleTicks <= 0) return null;
    const roll = this.roll;
    const core = roll.coreOf(0) as CharacterCore;
    roll.loadFlat(0, starts, 0);
    const hold = this.hold();
    let still = 0;
    for (let t = 1; t <= this.o.settleTicks; t++) {
      if ((t & 1) === 1) roll.setInput(0, resolveAim(hold, core.pos.x, core.pos.y));
      roll.step();
      if (!roll.isAlive(0) || roll.freezeTicksOf(0) > 0) return null;
      still = grounded(this.thin.col, core.pos.x, core.pos.y) && Math.hypot(core.vel.x, core.vel.y) < 0.5 ? still + 1 : 0;
      if (still >= 3) return { ticks: t, starts: this.rolled(starts, t) };
    }
    return null;
  }

  private *libraryPick(starts: Float64Array, maxMissed = Infinity, tier = 0): Generator<number, { pick: Route; target: number } | null, void> {
    if (this.library === null) return null;
    if (this.thin.fieldAt(starts[FLAT_POS_X], starts[FLAT_POS_Y]) - this.o.minDrop < 0) return null;
    if (tier === 3) return this.library.fast === null ? null : yield* this.libraryPickFrom(this.library.fast, starts, maxMissed);
    if (tier === 1) return yield* this.libraryPickFrom(this.library, starts, maxMissed);
    if (tier === 2 && this.library.secondary !== null) return yield* this.libraryPickFrom(this.library.secondary, starts, maxMissed);
    const second = this.library.secondary;
    const bonus = this.o.libraryTierBonus;
    if (second !== null && bonus < Infinity) {

      const ask = (l: SegmentLibrary): Candidate[] => l.candidates(starts, 0, this.o.libraryAsk, this.o.libraryReach, this.o.libraryWay);
      const both = [...ask(this.library).map((c) => ({ c, k: c.d - bonus })), ...ask(second).map((c) => ({ c, k: c.d }))];
      both.sort((x, y) => x.k - y.k);
      return yield* this.libraryPickFrom(this.library, starts, maxMissed, both.slice(0, this.o.libraryAsk).map((x) => x.c));
    }
    const first = yield* this.libraryPickFrom(this.library, starts, maxMissed);
    if (first !== null || second === null) return first;
    return yield* this.libraryPickFrom(second, starts, maxMissed);
  }

  private *libraryPickFrom(lib: SegmentLibrary, starts: Float64Array, maxMissed: number, list?: Candidate[]): Generator<number, { pick: Route; target: number } | null, void> {
    this.lookAsked = true;
    const field = this.thin.fieldAt(starts[FLAT_POS_X], starts[FLAT_POS_Y]);
    const Pc = segmentCopies(this.o);
    const cands = list ?? lib.candidates(starts, 0, this.o.libraryAsk, this.o.libraryReach, this.o.libraryWay);

    const ok: { tape: PlayerInput[]; misses: number; target: number; d: number; speed: number }[] = [];
    const end = new Float64Array(FLAT_STRIDE);
    let hit: { tape: PlayerInput[]; target: number } | null = null;
    const walker = this;

    const isFast = lib === this.library?.fast;
    const judge = function* (c: { tape: PlayerInput[]; misses: number; target: number; d: number }): Generator<number, boolean, void> {

      const allowed = Math.min(c.misses + (isFast ? FAST_MORE_MISSES : walker.o.libraryMisses), maxMissed);
      const end = isFast ? END_ENTRY : c.target;
      let missed = 0;

      for (let j = 1; j < Pc && missed <= allowed; j++) {
        if (!walker.plays(c.tape, 0, starts, j * FLAT_STRIDE, end, true)) missed++;
        yield walker.takeWork();
      }
      for (let j = 0; j < walker.o.jitterCopies && missed <= allowed; j++) {
        if (!walker.plays(c.tape, 0, starts, 0, end, true, j, undefined, 0, 0, isFast)) missed++;
        yield walker.takeWork();
      }
      if (missed > allowed) {
        if (isFast) walker.trace?.(`fast program: ${missed} copies miss it (${allowed} allowed)`);
        return false;
      }
      hit = c;
      walker.trace?.(`library program: ${c.tape.length} ticks, ${isFast ? "fast" : lib === walker.library ? "first" : "second"} tier, ${c.d.toFixed(0)} px from the state, ${missed} copies miss it`);
      return true;
    };
    for (const { tape, misses, from, d } of cands) {
      if (misses > this.o.libraryMaxMisses) continue;

      const target = this.thin.fieldAt(from.x, from.y) - this.o.minDrop;
      if (target < 0) continue;

      const held = isFast ? this.plays(tape, 0, starts, 0, END_ENTRY, false) : this.plays(tape, 0, starts, 0, target, false, -1, end, 0);
      const played = isFast ? tape.length : this.playedTicks;

      yield this.takeWork();
      if (isFast && !held) this.trace?.(`fast program: the nominal copy does not come through (${d.toFixed(0)} px from the state)`);
      if (!held) continue;

      const cut = this.o.libraryCut && this.o.lookahead && played < tape.length ? tape.slice(0, played) : tape;
      const c = { tape: cut, misses, target, d, speed: (field - this.thin.fieldAt(end[FLAT_POS_X], end[FLAT_POS_Y])) / Math.max(1, played) };
      ok.push(c);
      if (!this.o.librarySpeed && (yield* judge(c))) break;
    }
    if (this.o.librarySpeed) {
      yield this.takeWork();
      ok.sort((x, y) => y.speed - x.speed);
      for (const c of ok) if (yield* judge(c)) break;
    }
    if (cands.length > 0) this.lookSawCands = true;
    if (libraryLog.sink !== null) {
      const pr = lib.probe(starts, 0);
      libraryLog.sink({ x: Math.round(starts[FLAT_POS_X]), y: Math.round(starts[FLAT_POS_Y]), vx: Math.round(starts[FLAT_VEL_X] * 10) / 10, vy: Math.round(starts[FLAT_VEL_Y] * 10) / 10, hook: starts[FLAT_HOOK_STATE], jumped: starts[FLAT_JUMPED], frozen: starts[FLAT_FREEZE_LEFT] > 0, live: this.pendingLive, tileEntries: pr.tile, kindEntries: pr.kind, nearest: pr.nearest === Infinity ? -1 : Math.round(pr.nearest * 10) / 10, cands: cands.length, held: ok.length, allc: Pc - 1 + this.o.jitterCopies, outcome: hit !== null ? "hit" : cands.length === 0 ? "empty" : "failed" });
    }
    const got = hit as { tape: PlayerInput[]; target: number } | null;
    return got === null ? null : { pick: { inputs: got.tape, segmentEnd: true } as Route, target: got.target };
  }

  private trajectoryOf(starts: Float64Array, tape: readonly PlayerInput[], upto = Infinity): number[] {
    const roll = this.roll;
    roll.loadFlat(0, starts, 0);
    const buf = new Float64Array(FLAT_STRIDE);
    const out: number[] = [];
    const core = roll.coreOf(0) as CharacterCore;
    for (let k = 0; k + 1 < Math.min(tape.length, upto); k++) {
      roll.setInput(0, resolveAim(tape[k - (k & 1)], core.pos.x, core.pos.y));
      roll.step();
      if (!roll.isAlive(0)) break;
      if ((k + 1) % TRAJ_EVERY === 0) {
        roll.saveFlat(0, buf, 0);
        out.push(...trajectoryNumbers(buf, 0));
      }
    }
    return out;
  }

  fastEntry(starts: Float64Array, tape: readonly PlayerInput[]): LibraryEntry | null {
    const target = this.thin.fieldAt(starts[FLAT_POS_X], starts[FLAT_POS_Y]) - this.o.minDrop;
    if (!(target >= 0) || !this.plays(tape, 0, starts, 0, END_ENTRY, false)) return null;
    const entryAt = this.playedTicks;
    if (!this.plays(tape, 0, starts, 0, target, false, -1, undefined, 0, entryAt)) return null;
    const cut = this.playedTicks < tape.length ? tape.slice(0, this.playedTicks) : tape;

    const S = FLAT_STRIDE;
    const preds = new Float64Array(S * PRED_OFFSETS.length);
    for (let n = 0; n < PRED_OFFSETS.length; n++) preds.set(starts.subarray(0, S), n * S);
    const cs = this.copyStarts(preds);
    let missed = 0;
    for (let c = 1; c < segmentCopies(this.o); c++) if (!this.plays(cut, 0, cs, c * S, END_ENTRY, true)) missed++;
    for (let j = 0; j < this.o.jitterCopies; j++) if (!this.plays(cut, 0, cs, 0, END_ENTRY, true, j, undefined, 0, 0, true)) missed++;
    if (missed > FAST_MAX_MISSES) return null;

    return libraryEntry(starts, 0, cut, missed, this.trajectoryOf(starts, cut, entryAt + 8));
  }

  private *pickGen(starts: Float64Array): Generator<number, { pick: Route | null; target: number }, void> {
    const walker = this;
    const thin = this.thin;
    const field = thin.fieldAt(starts[FLAT_POS_X], starts[FLAT_POS_Y]);
    const target = field - this.o.minDrop;
    const seg = target >= 0 ? target : null;
    let pick: Route | null = null;
    let fallback: Route | null = null;
    const thinNodes = this.o.thinNodes * this.growth;
    const onwardNodes = this.o.onwardNodes * this.growth;
    if (this.o.candidates > 0) {
      thin.setSegment(seg);
      let cands = yield* thin.searchManyGen(starts.subarray(0, FLAT_STRIDE), MACRO_ROOT, thinNodes, this.o.candidates);
      thin.setSegment(null);
      const P = segmentCopies(this.o);

      const onwardOk = new Map<Route, boolean>();
      let onwardFails = 0;
      const onwardSearcher = this.onward;
      const goesOn = function* (c: Route): Generator<number, boolean, void> {
        if (onwardSearcher === null || c.segmentEnd !== true) return true;
        let ok = onwardOk.get(c);
        if (ok === undefined) {
          if (onwardFails >= ONWARD_TRIES) return true;
          ok = (yield* onwardSearcher.searchGen(c.states.subarray(c.ticks * FLAT_STRIDE), MACRO_ROOT, onwardNodes)) !== null;
          onwardOk.set(c, ok);
          if (!ok) {
            walker.deadEnds++;
            onwardFails++;
          }
        }
        return ok;
      };

      const all = P - 1 + this.o.jitterCopies;
      let graded: Route | null = null;
      let gradedHeld = -1;

      let anyHeld: Route | null = null;
      let anyHeldN = -1;
      const tried = new Set<string>();
      let stored = 0;
      for (let pass = 0; pass < 2 && pick === null; pass++) {
        if (pass === 1) {

          if (this.wide === null || cands.length === 0) break;
          this.wide.setSegment(seg);
          cands = yield* this.wide.searchManyGen(starts.subarray(0, FLAT_STRIDE), MACRO_ROOT, thinNodes, this.o.wideCandidates);
          this.wide.setSegment(null);
          this.widened++;
        }
        for (const c of cands) {
          const id = c.codes.join(",");
          if (tried.has(id)) continue;
          tried.add(id);
          const t = c.segmentEnd === true ? target : -1;
          let held = 0;

          for (let j = 1; j < P; j++) {
            if (this.plays(c.inputs, 0, starts, j * FLAT_STRIDE, t, true)) held++;
            yield this.takeWork();
          }
          for (let j = 0; j < this.o.jitterCopies; j++) {
            if (this.plays(c.inputs, 0, starts, 0, t, true, j)) held++;
            yield this.takeWork();
          }
          if (held === all && (yield* goesOn(c))) {
            if (pick === null) {
              pick = c;
              this.verified++;
            }
            if (this.library !== null && seg !== null && c.segmentEnd === true) {

              this.library.learnedTier()?.add(starts, 0, c.inputs, 0, this.trajectoryOf(starts, c.inputs));
              stored++;
            }

            if (this.o.libraryAll <= 1 || stored >= this.o.libraryAll) break;
            continue;
          }
          if (held > gradedHeld && (yield* goesOn(c))) {
            graded = c;
            gradedHeld = held;
          }
          if (held > anyHeldN) {
            anyHeld = c;
            anyHeldN = held;
          }
        }
      }
      if (graded === null) graded = anyHeld;

      if (pick === null) fallback = this.o.fallback === "segment" ? graded : (cands[0] ?? null);

      if (pick === null && fallback !== null && fallback === graded && graded.segmentEnd === true && seg !== null && this.library !== null) this.library.learnedTier()?.add(starts, 0, graded.inputs, all - (graded === anyHeld ? anyHeldN : gradedHeld), this.trajectoryOf(starts, graded.inputs));
    }
    if (pick === null && this.copies !== null && this.o.copiesSearch) {
      this.copies.setSegment(seg);
      pick = this.copies.search(starts, MACRO_ROOT, this.o.nodes);
      this.copies.setSegment(null);
      if (pick !== null) this.robust++;
    }
    if (pick === null && this.o.candidates === 0) {

      thin.setSegment(seg);
      fallback = yield* thin.searchGen(starts.subarray(0, FLAT_STRIDE), MACRO_ROOT, thinNodes);
      thin.setSegment(null);
    }
    const onwardWay = this.onward;
    const way = function* (): Generator<number, void, void> {
      if (pick !== null || onwardWay === null) return;
      pick = yield* onwardWay.searchGen(starts.subarray(0, FLAT_STRIDE), MACRO_ROOT, onwardNodes);
      if (pick !== null) walker.thinFound++;
    };
    if (this.o.fallback === "way") yield* way();
    if (pick === null && fallback !== null) {
      pick = fallback;
      this.thinFound++;
    }
    yield* way();
    return { pick, target };
  }

  private installed(pick: Route | null, target: number, frozenAtStart: boolean, at: number, now: number): PlayerInput {
    if (pick === null || pick.inputs.length === 0) {
      this.stalls++;
      this.tape = null;
      this.holdUntil = now + this.o.holdTicks;

      if (frozenAtStart) this.waitThaw = true;
      else {
        this.growth = Math.min(this.o.maxGrowth, this.growth * 2);
        this.stallRun++;
      }
      return this.last;
    }
    this.growth = 1;
    this.stallRun = 0;
    this.tape = pick.inputs;
    this.rootAt = at;
    this.target = pick.segmentEnd === true ? target : -1;
    return this.tape[0];
  }
}

export type SegmentWalkResult = { arrive: number; died: boolean; freezes: number; decisions: number; ms: number; searches: number; verified: number; robust: number; thinFound: number; deadEnds: number; realigned: number; stalls: number; searchMs: number; end?: string };

export function walkSegments(thin: PathSearcher, copies: PathSearcher | null, start: { x: number; y: number }, walk: LiveWalk & { segment?: Partial<SegmentOpts> }): SegmentWalkResult {
  const walker = new SegmentWalker(thin, copies, walk.segment);
  const r = liveLoop(thin.col, start, walk, (preds, now) => walker.decide(preds, now, walk.lag), (w) => thin.atGoal(w));
  return { ...r, searches: walker.searches, verified: walker.verified, robust: walker.robust, thinFound: walker.thinFound, deadEnds: walker.deadEnds, realigned: walker.realigned, stalls: walker.stalls, searchMs: walker.searchMs };
}

export type PathWalkPhase = "walking" | "arrived" | "failed";

export function segOptsFrom(v: string | undefined, warn: (msg: string) => void = (m) => console.error(m)): Partial<SegmentOpts> {
  if (v === undefined) return {};
  try {
    const o = JSON.parse(v) as unknown;
    if (typeof o === "object" && o !== null && !Array.isArray(o)) return o as Partial<SegmentOpts>;
    warn(`PATHFIND_SEG ignored: not an object of segment options: ${v}`);
  } catch (e) {
    warn(`PATHFIND_SEG ignored: ${(e as Error).message}`);
  }
  return {};
}
const SEG_ENV = segOptsFrom(process.env.PATHFIND_SEG);

export const WALKER_MAX_TICKS = 1200;

export class PathWalker {
  readonly goal: PathGoal;

  readonly startTile: { tx: number; ty: number };

  readonly maxTicks: number;
  private walked = 0;
  private lastTick = -1;
  overTime = false;
  private phaseValue: PathWalkPhase = "walking";
  private why = "";
  private readonly walker: SegmentWalker;
  private readonly sim: SimWorld;
  private readonly preds = new Float64Array(FLAT_STRIDE * PRED_OFFSETS.length);
  private sent: { tick: number; input: PlayerInput }[] = [];
  private readonly empty = emptyInput();

  constructor(col: Collision, goal: PathGoal, regionAround: { tx: number; ty: number }, opts: { search?: Partial<PathSearchOpts>; segment?: Partial<SegmentOpts>; clock?: () => number; library?: SegmentLibrary | null; trace?: (msg: string) => void; maxTicks?: number; entry?: readonly TileBox[] } = {}) {
    this.goal = goal;
    this.startTile = { ...regionAround };
    this.maxTicks = opts.maxTicks ?? WALKER_MAX_TICKS;
    const seg = { ...DEFAULT_SEGMENT, ...SEG_ENV, ...opts.segment };
    const thin = new PathSearcher(col, goal, { clearPx: 12, clearCost: 1, maxAnchors: WALKER_ANCHORS, w: WALKER_W, restTicks: seg.restTicks, ...opts.search, particles: 1, late: false, roots: false, maxNodes: seg.thinNodes * seg.maxGrowth, maxExpansions: 1e9, improveExpansions: opts.search?.improveExpansions ?? WALKER_IMPROVE, timeLimitMs: 1e9 }, regionAround);
    this.walker = new SegmentWalker(thin, null, seg, opts.clock, opts.library ?? null);
    this.walker.trace = opts.trace ?? null;
    this.walker.entryZone = opts.entry ?? null;
    this.sim = new SimWorld(col, { respawnDelayTicks: 1_000_000 });
    this.sim.addTee(0, { x: 0, y: 0 });
  }

  get phase(): PathWalkPhase {
    return this.phaseValue;
  }

  get done(): boolean {
    return this.phaseValue !== "walking";
  }

  seedFrom(states: Float64Array, inputs: readonly PlayerInput[]): { added: number; grades: number[] } {
    return this.walker.seedFrom(states, inputs);
  }

  fastEntry(starts: Float64Array, tape: readonly PlayerInput[]): LibraryEntry | null {
    return this.walker.fastEntry(starts, tape);
  }

  set crowded(v: boolean) {
    this.walker.crowded = v;
  }

  get onPlan(): boolean {
    return this.phaseValue === "walking" && this.walker.onPlan;
  }

  get reason(): string {
    return this.why;
  }

  get doing(): string {
    const w = this.walker;
    return `segments: ${w.verified} held, ${w.cacheHits} from the library, ${w.lookUsed} searched ahead, ${w.thinFound} as found, ${w.stalls} not found`;
  }

  step(self: TeeState, tick: number, lag: number): PlayerInput {
    if (this.done) return this.empty;
    if (this.lastTick >= 0 && tick > this.lastTick) this.walked += tick - this.lastTick;
    this.lastTick = tick;
    if (self.alive && goalReached(this.walker.thin.col, this.goal, self.pos.x, self.pos.y, self.vel.x, self.frozen)) {
      this.phaseValue = "arrived";
      this.why = `at the goal (${Math.trunc(self.pos.x / TILE)},${Math.trunc(self.pos.y / TILE)})`;
      return this.empty;
    }
    if (this.walker.capped) {
      this.phaseValue = "failed";
      this.why = `the search is over its CPU bound at (${Math.trunc(self.pos.x / TILE)},${Math.trunc(self.pos.y / TILE)})`;
      return this.empty;
    }
    if (this.walker.stuck) {
      this.phaseValue = "failed";
      this.why = `no way found from (${Math.trunc(self.pos.x / TILE)},${Math.trunc(self.pos.y / TILE)}) in ${this.walker.stalls} searches`;
      return this.empty;
    }
    if (this.walked > this.maxTicks) {
      this.phaseValue = "failed";
      this.overTime = true;
      this.why = `not at the goal after ${this.walked} ticks of walking (the cap is ${this.maxTicks}) at (${Math.trunc(self.pos.x / TILE)},${Math.trunc(self.pos.y / TILE)})`;
      return this.empty;
    }

    const cpu0 = process.cpuUsage();
    this.predict(self, tick, lag);
    const input = this.walker.decide(this.preds, tick, lag);
    const used = process.cpuUsage(cpu0);
    const usedMs = (used.user + used.system) / 1000;
    if (usedMs > walkerStats.maxStepCpuMs) walkerStats.maxStepCpuMs = usedMs;
    this.sent.push({ tick, input });

    while (this.sent.length > 0 && this.sent[0].tick + lag + 4 < tick) this.sent.shift();
    return input;
  }

  private predict(self: TeeState, tick: number, lag: number): void {
    const sim = this.sim;
    sim.applyTeeState(0, { ...self, id: 0 });
    const last = PRED_OFFSETS[PRED_OFFSETS.length - 1];
    let held = this.empty;
    for (const s of this.sent) if (s.tick + lag <= tick) held = s.input;
    for (let k = 0; ; k++) {
      const off = k - lag;
      for (let n = 0; n < PRED_OFFSETS.length; n++) if (PRED_OFFSETS[n] === off || (PRED_OFFSETS[n] < -lag && k === 0)) sim.saveFlat(0, this.preds, n * FLAT_STRIDE);
      if (off >= last) break;
      for (const s of this.sent) if (s.tick + lag === tick + k) held = s.input;
      sim.setInput(0, held);
      sim.step();
    }
  }
}

export function particleStarts(col: Collision, st: Float64Array, particles: number, nudgePx: number): Float64Array {
  const starts = new Float64Array(FLAT_STRIDE * particles);
  for (let j = 0; j < particles; j++) {
    starts.set(st.subarray(0, FLAT_STRIDE), j * FLAT_STRIDE);
    const nx = j === 0 ? 0 : (j % 2 === 1 ? nudgePx : -nudgePx) * Math.ceil(j / 2);
    const x = st[FLAT_POS_X] + nx;
    const y = st[FLAT_POS_Y];
    if (nx === 0 || col.isSolid(x - HALF, y - HALF) || col.isSolid(x + HALF, y - HALF) || col.isSolid(x - HALF, y + HALF) || col.isSolid(x + HALF, y + HALF)) continue;
    starts[j * FLAT_STRIDE + FLAT_POS_X] = x;
    starts[j * FLAT_STRIDE + FLAT_PREV_X] = st[FLAT_PREV_X] + nx;
  }
  return starts;
}

export function startState(col: Collision, pos: { x: number; y: number }, ticks: number): Float64Array {
  const w = new SimWorld(col, { respawnDelayTicks: 1_000_000 });
  w.addTee(0, pos);
  const e = emptyInput();
  for (let i = 0; i < ticks; i++) {
    w.setInput(0, e);
    w.step();
  }
  const st = new Float64Array(FLAT_STRIDE);
  w.saveFlat(0, st, 0);
  return st;
}
