import type { Collision } from "../core/collision.ts";
import { TILE_TELECHECKIN, TILE_TELECHECKINEVIL, TILE_TELEIN, TILE_TELEINEVIL, TILE_TELEOUT } from "../core/tuning.ts";
import { DEFAULT_SEARCH, unfreezeBelowOf } from "./pathfind.ts";
import type { PathGoal, TileBox } from "./pathfind.ts";

const TILE = 32;
export const TILE_START = 33;
export const TILE_FINISH = 34;
export const TILE_CP_FIRST = 35;
export const TILE_CP_LAST = 59;

const SPAWN_TILES = [192, 193, 194];

export const THAW_TILES = 2;

export const FREEZE_STEP_COST = 40;

const CLEAR_WEIGHT = 0.8;
const CLEAR_MAX = 3;

export const SUPPORT_UP = 11;
export const SUPPORT_SIDE = 8;
export const BARE_WEIGHT = 3;
export const GATE_HALF_TILES = 12;

export const BAND_RADIUS = 24;
export const BAND_DEPTH = 2;

export const THAW_TOUCH_TILES = 1;
export const THAW_DRIFT_TILES = 3;

const THAW_STATES = THAW_DRIFT_TILES + 2;

export const CELL_FREE = 0;
export const CELL_BLOCKED = 1;
export const CELL_THAW = 2;
export const CELL_TELE = 3;

export type Course = {
  width: number;
  height: number;

  path: number[];

  along: number[];

  cps: { cp: number; at: number }[];

  teles: number[];

  startLine: number;

  free: Uint8Array;

  toFinish: Float64Array;

  fromServerSpawn: boolean;

  directed?: true;
};

export type Section = {
  idx: number;

  label: string;

  from: number;
  to: number;

  tiles: number;

  tele?: true;
};

const front = (col: Collision, i: number): number => (col.frontIndex === undefined ? 0 : col.frontIndex[i]);
const centreOf = (col: Collision, i: number): { x: number; y: number } => ({ x: (i % col.width) * TILE + TILE / 2, y: Math.floor(i / col.width) * TILE + TILE / 2 });

export function cellKinds(col: Collision): Uint8Array {
  const W = col.width;
  const H = col.height;
  const kinds = new Uint8Array(W * H);
  const unfreeze = new Uint8Array(W * H);
  const fallU = unfreezeBelowOf(col);
  for (let i = 0; i < W * H; i++) {
    const c = centreOf(col, i);
    if (col.isUnFreeze(c.x, c.y)) unfreeze[i] = 1;
  }
  const thawNear = (x: number, y: number): boolean => {
    for (let dy = -THAW_TILES; dy <= THAW_TILES; dy++) {
      for (let dx = -THAW_TILES; dx <= THAW_TILES; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && unfreeze[ny * W + nx] === 1) return true;
      }
    }
    return false;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const c = centreOf(col, i);
      const tt = col.teleType === undefined ? 0 : col.teleType[i];
      if (col.isSolid(c.x, c.y) || col.isDeath(c.x, c.y) || tt === TILE_TELEINEVIL || tt === TILE_TELECHECKINEVIL || tt === TILE_TELECHECKIN) kinds[i] = CELL_BLOCKED;

      else if (col.isAnyFreeze(c.x, c.y)) kinds[i] = col.isDeepFreeze(c.x, c.y) ? CELL_BLOCKED : thawNear(x, y) || fallU[i] === 1 ? CELL_THAW : CELL_BLOCKED;
      else if (tt === TILE_TELEIN && col.teleNumber !== undefined && col.teleNumber[i] !== 0) kinds[i] = CELL_TELE;
    }
  }
  return kinds;
}

export const TELE_EXIT_SPREAD = 8;
export function teleExits(col: Collision, kinds: Uint8Array): Int32Array {
  const n = col.width * col.height;
  const W = col.width;
  const exits = new Int32Array(n).fill(-1);
  const types = col.teleType;
  const numbers = col.teleNumber;
  if (types === undefined || numbers === undefined) return exits;
  const outs = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (types[i] !== TILE_TELEOUT || numbers[i] === 0) continue;
    let l = outs.get(numbers[i]);
    if (l === undefined) outs.set(numbers[i], (l = []));
    l.push(i);
  }

  const usable = new Map<number, number>();
  for (const [number, l] of outs) {
    const x0 = l[0] % W;
    const y0 = (l[0] - x0) / W;
    const together = l.every((i) => kinds[i] === CELL_FREE && Math.max(Math.abs((i % W) - x0), Math.abs(Math.floor(i / W) - y0)) <= TELE_EXIT_SPREAD);
    usable.set(number, together ? l[0] : -1);
  }
  for (let i = 0; i < n; i++) {
    if (numbers[i] === 0) continue;
    if (types[i] === TILE_TELEIN) {
      if (kinds[i] !== CELL_TELE) continue;
    } else if (types[i] === TILE_TELEINEVIL) {
      const c = centreOf(col, i);
      if (col.isSolid(c.x, c.y) || col.isDeath(c.x, c.y) || col.isAnyFreeze(c.x, c.y)) continue;
    } else continue;
    exits[i] = usable.get(numbers[i]) ?? -1;
  }
  return exits;
}

export function clearance(kinds: Uint8Array, W: number, H: number): Uint8Array {
  const d = new Uint8Array(W * H).fill(CLEAR_MAX);
  const queue: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (kinds[i] === CELL_BLOCKED) {
      d[i] = 0;
      queue.push(i);
    }
  }
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h];
    const x = i % W;
    const y = (i - x) / W;
    if (d[i] >= CLEAR_MAX - 1) continue;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (d[j] > d[i] + 1) {
          d[j] = d[i] + 1;
          queue.push(j);
        }
      }
    }
  }
  return d;
}

export function supportOf(col: Collision): Uint8Array {
  const W = col.width;
  const H = col.height;
  const sat = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      const c = centreOf(col, y * W + x);
      if (col.isSolid(c.x, c.y) && !col.isNoHook(c.x, c.y)) row++;
      sat[(y + 1) * (W + 1) + x + 1] = sat[y * (W + 1) + x + 1] + row;
    }
  }
  const boxSum = (x0: number, y0: number, x1: number, y1: number): number =>
    sat[(y1 + 1) * (W + 1) + x1 + 1] - sat[y0 * (W + 1) + x1 + 1] - sat[(y1 + 1) * (W + 1) + x0] + sat[y0 * (W + 1) + x0];
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (y + 1 < H && col.isSolid(x * TILE + TILE / 2, (y + 1) * TILE + TILE / 2) && !col.isAnyFreeze(x * TILE + TILE / 2, y * TILE + TILE / 2)) {
        out[i] = 1;
        continue;
      }
      if (y === 0) continue;
      if (boxSum(Math.max(0, x - SUPPORT_SIDE), Math.max(0, y - SUPPORT_UP), Math.min(W - 1, x + SUPPORT_SIDE), y - 1) > 0) out[i] = 1;
    }
  }
  return out;
}

class Heap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.vals.length;
  }
  push(k: number, v: number): void {
    const keys = this.keys;
    const vals = this.vals;
    let i = vals.length;
    keys.push(k);
    vals.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= k) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = k;
    vals[i] = v;
  }

  lastKey = 0;
  pop(): number {
    const keys = this.keys;
    const vals = this.vals;
    const topV = vals[0];
    this.lastKey = keys[0];
    const k = keys.pop() as number;
    const v = vals.pop() as number;
    const n = vals.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= k) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = k;
      vals[i] = v;
    }
    return topV;
  }
}

export function tilesOf(col: Collision, ids: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < col.width * col.height; i++) if (ids.includes(col.tiles[i]) || ids.includes(front(col, i))) out.push(i);
  return out;
}

export function serverSpawnOf(col: Collision): number {
  for (const id of SPAWN_TILES) {
    for (let i = 0; i < col.width * col.height; i++) if (col.tiles[i] === id || front(col, i) === id) return i;
  }
  return -1;
}

function thawStep(kinds: Uint8Array, touch: Uint8Array, fallU: Uint8Array, W: number, i: number, j: number, s: number): number {
  if (kinds[j] === CELL_THAW) return 1;
  if (s === 0) return 0;
  if (touch[j] === 1) return 0;

  const dx = (j % W) - (i % W);
  const dy = Math.floor(j / W) - Math.floor(i / W);
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return s;
  if (fallU[j] === 1 && dx === 0 && dy === 1) return s;
  return s <= THAW_DRIFT_TILES ? s + 1 : -1;
}

function thawTouch(col: Collision): Uint8Array {
  const W = col.width;
  const H = col.height;
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const c = centreOf(col, i);
    if (!col.isUnFreeze(c.x, c.y)) continue;
    const x = i % W;
    const y = (i - x) / W;
    for (let dy = -THAW_TOUCH_TILES; dy <= THAW_TOUCH_TILES; dy++) {
      for (let dx = -THAW_TOUCH_TILES; dx <= THAW_TOUCH_TILES; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H) out[ny * W + nx] = 1;
      }
    }
  }
  return out;
}

export function thawCheck(col: Collision, path: readonly number[], kinds: Uint8Array = cellKinds(col), touch: Uint8Array = thawTouch(col)): number {
  const fallU = unfreezeBelowOf(col);
  let s = 0;
  for (let k = 1; k < path.length; k++) {
    s = thawStep(kinds, touch, fallU, col.width, path[k - 1], path[k], s);
    if (s < 0) return k;
  }
  return -1;
}

export function courseOf(col: Collision): Course | null {
  const W = col.width;
  const H = col.height;
  const kinds = cellKinds(col);
  const clear = clearance(kinds, W, H);
  const support = supportOf(col);
  let sources = tilesOf(col, SPAWN_TILES).filter((i) => kinds[i] !== CELL_BLOCKED);
  if (sources.length === 0) sources = tilesOf(col, [TILE_START]).filter((i) => kinds[i] !== CELL_BLOCKED);
  const finish = new Set(tilesOf(col, [TILE_FINISH]).filter((i) => kinds[i] !== CELL_BLOCKED));
  if (sources.length === 0 || finish.size === 0) return null;
  const exits = teleExits(col, kinds);

  const server = serverSpawnOf(col);
  const attempts: number[][] = server >= 0 && kinds[server] !== CELL_BLOCKED && sources.length > 1 ? [[server], sources] : [sources];
  const stepCost = (j: number, len: number): number => len * (1 + CLEAR_WEIGHT * (CLEAR_MAX - clear[j]) + (support[j] === 0 ? BARE_WEIGHT : 0)) + (kinds[j] === CELL_THAW ? FREEZE_STEP_COST : 0);
  const forward = (from: readonly number[]): { end: number; prev: Int32Array } => {
    const dist = new Float64Array(W * H).fill(Infinity);
    const prev = new Int32Array(W * H).fill(-1);
    const heap = new Heap();
    for (const s of from) {
      dist[s] = 0;
      heap.push(0, s);
    }
    let end = -1;
    while (heap.size > 0) {
      const i = heap.pop();
      const d = heap.lastKey;
      if (d > dist[i]) continue;
      if (finish.has(i)) {
        end = i;
        break;
      }
      const relax = (j: number, c: number): void => {
        if (d + c < dist[j]) {
          dist[j] = d + c;
          prev[j] = i;
          heap.push(d + c, j);
        }
      };

      if (exits[i] >= 0) {
        relax(exits[i], 1);
        continue;
      }
      if (kinds[i] === CELL_TELE) continue;
      const x = i % W;
      const y = (i - x) / W;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue;
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (kinds[j] === CELL_BLOCKED && exits[j] < 0) continue;
          if (ox !== 0 && oy !== 0 && (kinds[y * W + nx] === CELL_BLOCKED || kinds[ny * W + x] === CELL_BLOCKED)) continue;
          relax(j, stepCost(j, ox !== 0 && oy !== 0 ? Math.SQRT2 : 1));
        }
      }
    }
    return { end, prev };
  };
  let end = -1;
  let prev: Int32Array = new Int32Array(0);
  let fromServerSpawn = false;
  for (let a = 0; a < attempts.length && end < 0; a++) {
    const r = forward(attempts[a]);
    end = r.end;
    prev = r.prev;
    fromServerSpawn = end >= 0 && (attempts.length === 1 ? server >= 0 && attempts[0].length === 1 && attempts[0][0] === server : a === 0);
  }
  if (end < 0) return null;
  let path: number[] = [];
  for (let i = end; i >= 0; i = prev[i]) path.push(i);
  path.reverse();

  const touch = thawTouch(col);
  let directed = false;
  if (thawCheck(col, path, kinds, touch) >= 0) {
    const d = directedPath(col, kinds, exits, finish, path[0], stepCost, touch);
    if (d !== null) {
      path = d;
      directed = true;
    }
  }
  const along: number[] = [0];
  const teles: number[] = [];
  for (let k = 1; k < path.length; k++) {
    const dx = (path[k] % W) - (path[k - 1] % W);
    const dy = Math.floor(path[k] / W) - Math.floor(path[k - 1] / W);
    const tele = Math.abs(dx) > 1 || Math.abs(dy) > 1;
    if (tele) teles.push(k);
    along.push(along[k - 1] + (tele ? 0 : Math.hypot(dx, dy)));
  }
  const cps: { cp: number; at: number }[] = [];
  const seen = new Set<number>();
  let startLine = -1;
  for (let k = 0; k < path.length; k++) {
    const i = path[k];
    for (const t of [col.tiles[i], front(col, i)]) {
      if (t === TILE_START && startLine < 0) startLine = k;
      if (t >= TILE_CP_FIRST && t <= TILE_CP_LAST && !seen.has(t)) {
        seen.add(t);
        cps.push({ cp: t - TILE_CP_FIRST, at: k });
      }
    }
  }
  const free = new Uint8Array(path.length);
  for (let k = 0; k < path.length; k++) free[k] = kinds[path[k]] === CELL_FREE ? 1 : 0;

  const plainIns = new Map<number, number[]>();
  const evilIns = new Map<number, number[]>();
  if (col.teleType !== undefined && col.teleNumber !== undefined) {
    const crossed = new Set<number>();
    for (const k of teles) if (col.teleType[path[k - 1]] === TILE_TELEINEVIL) crossed.add(col.teleNumber[path[k - 1]]);
    for (let i = 0; i < W * H; i++) {
      if (kinds[i] === CELL_TELE) {
        const n = col.teleNumber[i];
        let l = plainIns.get(n);
        if (l === undefined) plainIns.set(n, (l = []));
        l.push(i);
      } else if (exits[i] >= 0 && col.teleType[i] === TILE_TELEINEVIL && crossed.has(col.teleNumber[i])) {
        let l = evilIns.get(exits[i]);
        if (l === undefined) evilIns.set(exits[i], (l = []));
        l.push(i);
      }
    }
  }

  if (directed) {
    const directedCost = directedToFinish(col, kinds, exits, finish, stepCost, touch, plainIns, evilIns);
    return { width: W, height: H, path, along, cps, teles, startLine, free, toFinish: directedCost, fromServerSpawn, directed: true as const };
  }

  const toFinish = new Float64Array(W * H).fill(Infinity);
  const back = new Heap();
  for (const f of finish) {
    toFinish[f] = 0;
    back.push(0, f);
  }
  while (back.size > 0) {
    const j = back.pop();
    const d = back.lastKey;
    if (d > toFinish[j]) continue;
    const relax = (i: number, c: number): void => {
      if (d + c < toFinish[i]) {
        toFinish[i] = d + c;
        back.push(d + c, i);
      }
    };
    if (col.teleType !== undefined && col.teleNumber !== undefined && col.teleType[j] === TILE_TELEOUT) for (const i of plainIns.get(col.teleNumber[j]) ?? []) relax(i, 1);
    for (const i of evilIns.get(j) ?? []) relax(i, 1);
    const x = j % W;
    const y = (j - x) / W;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const i = ny * W + nx;

        if (kinds[i] === CELL_BLOCKED || kinds[i] === CELL_TELE) continue;
        if (ox !== 0 && oy !== 0 && (kinds[y * W + nx] === CELL_BLOCKED || kinds[ny * W + x] === CELL_BLOCKED)) continue;
        relax(i, stepCost(j, ox !== 0 && oy !== 0 ? Math.SQRT2 : 1));
      }
    }
  }
  return { width: W, height: H, path, along, cps, teles, startLine, free, toFinish, fromServerSpawn };
}

function directedToFinish(
  col: Collision,
  kinds: Uint8Array,
  exits: Int32Array,
  finish: ReadonlySet<number>,
  stepCost: (j: number, len: number) => number,
  touch: Uint8Array,
  plainIns: ReadonlyMap<number, number[]>,
  evilIns: ReadonlyMap<number, number[]>,
): Float64Array {
  const W = col.width;
  const H = col.height;
  const S = THAW_STATES;
  const fallU = unfreezeBelowOf(col);
  const dist = new Float64Array(W * H * S).fill(Infinity);
  const heap = new Heap();
  for (const f of finish) {
    for (let s = 0; s < S; s++) {
      dist[f * S + s] = 0;
      heap.push(0, f * S + s);
    }
  }
  while (heap.size > 0) {
    const v = heap.pop();
    const d = heap.lastKey;
    if (d > dist[v]) continue;
    const j = Math.floor(v / S);
    const s2 = v - j * S;

    const relax = (i: number, c: number): void => {
      for (let s = 0; s < S; s++) {
        if (thawStep(kinds, touch, fallU, W, i, j, s) !== s2) continue;
        const u = i * S + s;
        if (d + c < dist[u]) {
          dist[u] = d + c;
          heap.push(d + c, u);
        }
      }
    };
    if (col.teleType !== undefined && col.teleNumber !== undefined && col.teleType[j] === TILE_TELEOUT) for (const i of plainIns.get(col.teleNumber[j]) ?? []) relax(i, 1);
    for (const i of evilIns.get(j) ?? []) relax(i, 1);
    if (kinds[j] === CELL_BLOCKED && exits[j] < 0) continue;
    const x = j % W;
    const y = (j - x) / W;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const i = ny * W + nx;

        if (exits[i] >= 0 || kinds[i] === CELL_TELE || kinds[i] === CELL_BLOCKED) continue;
        if (ox !== 0 && oy !== 0 && (kinds[ny * W + x] === CELL_BLOCKED || kinds[y * W + nx] === CELL_BLOCKED)) continue;
        relax(i, stepCost(j, ox !== 0 && oy !== 0 ? Math.SQRT2 : 1));
      }
    }
  }
  const out = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const fz = kinds[i] === CELL_THAW ? dist[i * S + 1] : Infinity;
    out[i] = Number.isFinite(fz) ? fz : dist[i * S];
  }
  return out;
}

function directedPath(col: Collision, kinds: Uint8Array, exits: Int32Array, finish: ReadonlySet<number>, start: number, stepCost: (j: number, len: number) => number, touch: Uint8Array): number[] | null {
  const W = col.width;
  const H = col.height;
  const S = THAW_STATES;
  const fallU = unfreezeBelowOf(col);
  const dist = new Float64Array(W * H * S).fill(Infinity);
  const prev = new Int32Array(W * H * S).fill(-1);
  const heap = new Heap();
  dist[start * S] = 0;
  heap.push(0, start * S);
  let end = -1;
  while (heap.size > 0) {
    const v = heap.pop();
    const d = heap.lastKey;
    if (d > dist[v]) continue;
    const i = Math.floor(v / S);
    const s = v - i * S;
    if (finish.has(i)) {
      end = v;
      break;
    }
    const relax = (j: number, c: number): void => {
      const s2 = thawStep(kinds, touch, fallU, W, i, j, s);
      if (s2 < 0) return;
      const u = j * S + s2;
      if (d + c < dist[u]) {
        dist[u] = d + c;
        prev[u] = v;
        heap.push(d + c, u);
      }
    };
    if (exits[i] >= 0) {
      relax(exits[i], 1);
      continue;
    }
    if (kinds[i] === CELL_TELE) continue;
    const x = i % W;
    const y = (i - x) / W;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (kinds[j] === CELL_BLOCKED && exits[j] < 0) continue;
        if (ox !== 0 && oy !== 0 && (kinds[y * W + nx] === CELL_BLOCKED || kinds[ny * W + x] === CELL_BLOCKED)) continue;
        relax(j, stepCost(j, ox !== 0 && oy !== 0 ? Math.SQRT2 : 1));
      }
    }
  }
  if (end < 0) return null;
  const path: number[] = [];
  for (let v = end; v >= 0; v = prev[v]) path.push(Math.floor(v / S));
  path.reverse();
  return path;
}

function indexAt(course: Course, tiles: number, lo: number): number {
  let k = lo;
  while (k < course.path.length - 1 && course.along[k] < tiles) k++;
  return onFree(course, k);
}

function onFree(course: Course, k: number): number {
  while (k < course.path.length - 1 && course.free[k] === 0) k++;
  return k;
}

export function cutSections(course: Course, every: number, maxTiles = 2 * every): Section[] {
  const last = course.path.length - 1;

  const pieces: { from: number; to: number; label: string }[] = [];
  if (course.cps.length > 0) {
    const inside = course.cps.filter((c) => c.at > 0 && c.at < last);
    const cuts = [0, ...inside.map((c) => onFree(course, c.at)), last];
    const names = ["start", ...inside.map((c) => `cp${c.cp}`)];
    for (let n = 0; n + 1 < cuts.length; n++) {
      const from = cuts[n];
      const to = cuts[n + 1];
      if (to <= from) continue;
      const len = course.along[to] - course.along[from];
      if (len <= maxTiles) {
        pieces.push({ from, to, label: names[n] });
        continue;
      }
      const parts = Math.max(2, Math.round(len / every));
      let a = from;
      for (let p = 1; p <= parts; p++) {
        const b = p === parts ? to : Math.min(to, indexAt(course, course.along[from] + (len * p) / parts, a + 1));
        if (b > a) pieces.push({ from: a, to: b, label: `${names[n]}.${p - 1}` });
        a = b;
      }
    }
  } else {
    let a = 0;
    let n = 0;
    while (a < last) {
      let b = indexAt(course, course.along[a] + every, a + 1);

      if (course.along[last] - course.along[b] < every / 2) b = last;
      pieces.push({ from: a, to: b, label: `s${n++}` });
      a = b;
    }
  }

  const out: Section[] = [];
  for (const p of pieces) {
    let a = p.from;
    let part = 0;
    for (const k of course.teles) {
      if (k <= a || k > p.to) continue;
      let e = k - 2;
      while (e > a && course.free[e] === 0) e--;
      if (e > a) out.push({ idx: out.length, label: part === 0 ? p.label : `${p.label}+${part}`, from: a, to: e, tiles: course.along[e] - course.along[a] });
      const from = Math.max(a, e);
      out.push({ idx: out.length, label: `${p.label}+tele${part}`, from, to: k, tiles: course.along[k] - course.along[from], tele: true });
      part++;
      a = k;
    }
    if (p.to > a) out.push({ idx: out.length, label: part === 0 ? p.label : `${p.label}+${part}`, from: a, to: p.to, tiles: course.along[p.to] - course.along[a] });
  }
  return out;
}

export const START_SNAP_TILES = 4;
export function sectionStart(col: Collision, course: Course, sec: Section): { x: number; y: number; grounded: boolean } {
  const W = col.width;
  for (let k = sec.from; k <= Math.min(sec.to - 1, sec.from + START_SNAP_TILES); k++) {
    const i = course.path[k];
    const x = i % W;
    const y = (i - x) / W;
    if (y + 1 >= col.height) continue;
    const c = centreOf(col, i);
    const below = { x: c.x, y: c.y + TILE };

    if (!col.isSolid(below.x, below.y) || col.isAnyFreeze(c.x, c.y) || col.isDeath(c.x, c.y)) continue;
    return { x: c.x, y: (y + 1) * TILE - 15, grounded: true };
  }
  const c = centreOf(col, course.path[sec.from]);
  return { ...c, grounded: false };
}

export function gateCells(col: Collision, course: Course, at: number, kinds: Uint8Array = cellKinds(col)): number[] {
  const W = col.width;
  const path = course.path;
  const k0 = Math.max(0, at - 2);
  const k1 = Math.min(path.length - 1, at + 2);
  let dx = (path[k1] % W) - (path[k0] % W);
  let dy = Math.floor(path[k1] / W) - Math.floor(path[k0] / W);

  if (Math.abs(dx) > 4 || Math.abs(dy) > 4 || (dx === 0 && dy === 0)) {
    dx = 1;
    dy = 0;
  }
  const len = Math.hypot(dx, dy);
  const px = -dy / len;
  const py = dx / len;
  const cx = (path[at] % W) + 0.5;
  const cy = Math.floor(path[at] / W) + 0.5;
  const cells = new Set<number>();
  const free = (i: number): boolean => kinds[i] === CELL_FREE;
  const cellAt = (x: number, y: number): number => {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    return tx < 0 || ty < 0 || tx >= W || ty >= col.height ? -1 : ty * W + tx;
  };

  const ax = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0;
  const ay = Math.abs(dx) >= Math.abs(dy) ? 0 : Math.sign(dy);
  for (const side of [1, -1]) {

    for (let s = side === 1 ? 0 : 0.25; s <= GATE_HALF_TILES; s += 0.25) {
      const i = cellAt(cx + side * s * px, cy + side * s * py);
      if (i < 0 || !free(i)) break;
      cells.add(i);
      const j = cellAt(cx + side * s * px + ax, cy + side * s * py + ay);
      if (j >= 0 && free(j)) cells.add(j);
    }
  }

  cells.add(path[at]);
  return [...cells].sort((a, b) => a - b);
}

export function bandCells(col: Collision, course: Course, at: number, kinds: Uint8Array = cellKinds(col)): number[] {
  const W = col.width;
  const H = col.height;
  const f = course.toFinish;
  const s = course.path[at];
  const top = f[s];
  if (!Number.isFinite(top)) return [s];
  const sx = s % W;
  const sy = (s - sx) / W;
  const cells: number[] = [];
  for (let y = Math.max(0, sy - BAND_RADIUS); y <= Math.min(H - 1, sy + BAND_RADIUS); y++) {
    for (let x = Math.max(0, sx - BAND_RADIUS); x <= Math.min(W - 1, sx + BAND_RADIUS); x++) {
      const i = y * W + x;
      if (kinds[i] !== CELL_FREE || !(f[i] <= top)) continue;
      let edge = false;
      for (let oy = -BAND_DEPTH; oy <= BAND_DEPTH && !edge; oy++) {
        for (let ox = -BAND_DEPTH; ox <= BAND_DEPTH; ox++) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;

          if (kinds[j] !== CELL_BLOCKED && f[j] > top && Number.isFinite(f[j])) {
            edge = true;
            break;
          }
        }
      }
      if (edge) cells.push(i);
    }
  }
  return cells;
}

export function courseField(course: Course, to: number, v: number): Float64Array {
  const f = course.toFinish;
  const path = course.path;
  const step = TILE / v;

  const cost = new Float64Array(to + 1);
  const left = new Float64Array(to + 1);
  for (let k = 0; k <= to; k++) {
    cost[k] = f[path[k]];
    left[k] = course.along[to] - course.along[k];
  }

  for (let k = to - 1; k >= 0; k--) if (cost[k] < cost[k + 1]) cost[k] = cost[k + 1];
  const top = cost[to];
  const field = new Float64Array(f.length);
  for (let i = 0; i < field.length; i++) {
    const c = f[i];
    if (!(c > top)) {
      field[i] = c <= top ? 0 : Infinity;
      continue;
    }
    if (c === Infinity) {
      field[i] = Infinity;
      continue;
    }
    if (c >= cost[0]) {

      field[i] = (left[0] + (c - cost[0])) * step;
      continue;
    }

    let lo = 0;
    let hi = to;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cost[mid] >= c) lo = mid;
      else hi = mid;
    }
    const span = cost[lo] - cost[hi];
    const t = span > 0 ? (cost[lo] - c) / span : 0;
    field[i] = (left[lo] + t * (left[hi] - left[lo])) * step;
  }
  return field;
}

export function sectionGoal(col: Collision, course: Course, sec: Section, kinds: Uint8Array = cellKinds(col), v: number = DEFAULT_SEARCH.v): PathGoal {
  const W = col.width;
  if (sec.tele === true) {
    const i = course.path[sec.to];
    const x = i % W;
    return { zone: [{ x0: x, y0: (i - x) / W, x1: x, y1: (i - x) / W }], spots: [], stop: false, pass: true, tele: true };
  }
  const field = Number.isFinite(course.toFinish[course.path[sec.to]]) ? courseField(course, sec.to, v) : undefined;
  let cells = [...new Set([...gateCells(col, course, sec.to, kinds), ...bandCells(col, course, sec.to, kinds)])].sort((a, b) => a - b);

  if (sec.to === course.path.length - 1) {
    const isFinish = (i: number): boolean => col.tiles[i] === TILE_FINISH || front(col, i) === TILE_FINISH;
    const finish = cells.filter(isFinish);
    if (finish.length > 0) {
      const last = course.path[sec.to];
      const before = course.path[Math.max(0, sec.to - 2)];
      const dx = (last % W) - (before % W);
      const dy = Math.floor(last / W) - Math.floor(before / W);
      const step = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : Math.sign(dy) * W;
      const past = step === 0 ? [] : finish.map((i) => i + step).filter((i) => i >= 0 && i < kinds.length && kinds[i] === CELL_FREE && !isFinish(i) && (Math.abs(step) !== 1 || Math.floor(i / W) === Math.floor((i - step) / W)));
      cells = [...new Set([...finish, ...past])].sort((a, b) => a - b);
    }
  }
  const zone: TileBox[] = [];
  for (const i of cells) {
    const x = i % W;
    const y = (i - x) / W;
    const last = zone[zone.length - 1];
    if (last !== undefined && last.y0 === y && last.x1 === x - 1) last.x1 = x;
    else zone.push({ x0: x, y0: y, x1: x, y1: y });
  }
  return field === undefined ? { zone, spots: [], stop: false, pass: true } : { zone, spots: [], stop: false, pass: true, field };
}
