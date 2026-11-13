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
};

export type Section = {
  idx: number;

  label: string;

  from: number;
  to: number;

  tiles: number;
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
      else if (col.isAnyFreeze(c.x, c.y)) kinds[i] = thawNear(x, y) || fallU[i] === 1 ? CELL_THAW : CELL_BLOCKED;
      else if (tt === TILE_TELEIN && col.teleNumber !== undefined && col.teleNumber[i] !== 0) kinds[i] = CELL_TELE;
    }
  }
  return kinds;
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
  const outs = new Map<number, number[]>();
  if (col.teleType !== undefined && col.teleNumber !== undefined) {
    for (let i = 0; i < W * H; i++) {
      if (col.teleType[i] !== TILE_TELEOUT || kinds[i] === CELL_BLOCKED) continue;
      const n = col.teleNumber[i];
      let l = outs.get(n);
      if (l === undefined) outs.set(n, (l = []));
      l.push(i);
    }
  }
  const dist = new Float64Array(W * H).fill(Infinity);
  const prev = new Int32Array(W * H).fill(-1);
  const heap = new Heap();
  for (const s of sources) {
    dist[s] = 0;
    heap.push(0, s);
  }
  const stepCost = (j: number, len: number): number => len * (1 + CLEAR_WEIGHT * (CLEAR_MAX - clear[j]) + (support[j] === 0 ? BARE_WEIGHT : 0)) + (kinds[j] === CELL_THAW ? FREEZE_STEP_COST : 0);
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

    if (kinds[i] === CELL_TELE && col.teleNumber !== undefined) {
      for (const j of outs.get(col.teleNumber[i]) ?? []) relax(j, 1);
      continue;
    }
    const x = i % W;
    const y = (i - x) / W;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (kinds[j] === CELL_BLOCKED) continue;
        if (ox !== 0 && oy !== 0 && (kinds[y * W + nx] === CELL_BLOCKED || kinds[ny * W + x] === CELL_BLOCKED)) continue;
        relax(j, stepCost(j, ox !== 0 && oy !== 0 ? Math.SQRT2 : 1));
      }
    }
  }
  if (end < 0) return null;
  const path: number[] = [];
  for (let i = end; i >= 0; i = prev[i]) path.push(i);
  path.reverse();
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

  const toFinish = new Float64Array(W * H).fill(Infinity);
  const ins = new Map<number, number[]>();
  if (col.teleNumber !== undefined) {
    for (let i = 0; i < W * H; i++) {
      if (kinds[i] !== CELL_TELE) continue;
      const n = col.teleNumber[i];
      let l = ins.get(n);
      if (l === undefined) ins.set(n, (l = []));
      l.push(i);
    }
  }
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
    if (col.teleType !== undefined && col.teleNumber !== undefined && col.teleType[j] === TILE_TELEOUT) for (const i of ins.get(col.teleNumber[j]) ?? []) relax(i, 1);
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
  return { width: W, height: H, path, along, cps, teles, startLine, free, toFinish };
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
  const field = Number.isFinite(course.toFinish[course.path[sec.to]]) ? courseField(course, sec.to, v) : undefined;
  const cells = [...new Set([...gateCells(col, course, sec.to, kinds), ...bandCells(col, course, sec.to, kinds)])].sort((a, b) => a - b);
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
