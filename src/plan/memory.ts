import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";

const TILE_PX = 32;

const SPREAD = 0.4;

const DECAY = 0.97;

export const CTX_BUCKETS = 5;
export const CTX_SLOW = 0;
export const CTX_LEFT = 1;
export const CTX_RIGHT = 2;
export const CTX_FALL = 3;
export const CTX_RISE = 4;

const CTX_SLOW_PX = 5;

const CTX_OFF_WEIGHT = 0.25;

const CTX_DOMINANT = 2 / 3;
const CTX_TIGHTEN_MAX = 2;

export function velBucket(vx: number, vy: number): number {
  if (!Number.isFinite(vx) || !Number.isFinite(vy)) return -1;
  if (vx * vx + vy * vy < CTX_SLOW_PX * CTX_SLOW_PX) return CTX_SLOW;
  if (Math.abs(vx) >= Math.abs(vy)) return vx < 0 ? CTX_LEFT : CTX_RIGHT;
  return vy > 0 ? CTX_FALL : CTX_RISE;
}

export class FreezeMemory {
  readonly width: number;
  readonly height: number;
  private readonly cells: Float32Array;

  private readonly passes: Float32Array;
  private events = 0;

  readonly key: string | undefined;

  private readonly ctx = new Map<number, Float32Array>();

  constructor(width: number, height: number, cells?: Float32Array, passes?: Float32Array, key?: string) {
    this.width = width;
    this.height = height;
    this.key = key;
    this.cells = cells !== undefined && cells.length === width * height ? cells : new Float32Array(width * height);
    this.passes = passes !== undefined && passes.length === width * height ? passes : new Float32Array(width * height);
  }

  notePass(x: number, y: number): void {
    const tx = Math.trunc(x / TILE_PX);
    const ty = Math.trunc(y / TILE_PX);
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return;
    this.passes[ty * this.width + tx] += 1;
  }

  safety(x: number, y: number): number {
    const tx = Math.trunc(x / TILE_PX);
    const ty = Math.trunc(y / TILE_PX);
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return 0;
    const i = ty * this.width + tx;
    const good = this.passes[i];
    const bad = this.cells[i];
    if (good <= 0) return 0;

    const clean = good / (good + 15 * bad);
    return clean * (good / (good + 10));
  }

  get noted(): number {
    return this.events;
  }

  note(x: number, y: number, vx?: number, vy?: number): void {
    const tx = Math.trunc(x / TILE_PX);
    const ty = Math.trunc(y / TILE_PX);
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return;
    this.events++;
    const b = vx === undefined || vy === undefined ? -1 : velBucket(vx, vy);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const nx = tx + ox;
        const ny = ty + oy;
        if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) continue;
        const i = ny * this.width + nx;
        const add = ox === 0 && oy === 0 ? 1 : SPREAD;
        this.cells[i] += add;
        if (b >= 0) {
          let row = this.ctx.get(i);
          if (row === undefined) this.ctx.set(i, (row = new Float32Array(CTX_BUCKETS)));
          row[b] += add;
        }
      }
    }
  }

  private cellFor(i: number, b: number): number {
    const v = this.cells[i];
    if (v <= 0 || b < 0) return v;
    const row = this.ctx.get(i);
    if (row === undefined) return v;

    const share = row[b] / v;
    if (share >= CTX_DOMINANT - 1e-6) return Math.min(CTX_TIGHTEN_MAX * v, v * (1 + ((CTX_TIGHTEN_MAX - 1) * (share - CTX_DOMINANT)) / (1 - CTX_DOMINANT)));
    let known = 0;
    let seen = 0;
    for (let k = 0; k < CTX_BUCKETS; k++) {
      known += row[k];
      seen += (k === b ? 1 : CTX_OFF_WEIGHT) * row[k];
    }

    const rest = v - known;
    return Math.min(v, seen + (rest >= 0.01 ? rest : 0));
  }

  riskAt(x: number, y: number, vx: number, vy: number): number {
    const tx = Math.trunc(x / TILE_PX);
    const ty = Math.trunc(y / TILE_PX);
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return 0;
    const v = this.cellFor(ty * this.width + tx, velBucket(vx, vy));
    return v <= 0 ? 0 : v / (1 + v);
  }

  safetyAt(x: number, y: number, vx: number, vy: number): number {
    const tx = Math.trunc(x / TILE_PX);
    const ty = Math.trunc(y / TILE_PX);
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return 0;
    const i = ty * this.width + tx;
    const good = this.passes[i];
    if (good <= 0) return 0;
    const bad = this.cellFor(i, velBucket(vx, vy));
    const clean = good / (good + 15 * bad);
    return clean * (good / (good + 10));
  }

  risk(x: number, y: number): number {
    const tx = Math.trunc(x / TILE_PX);
    const ty = Math.trunc(y / TILE_PX);
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return 0;
    const v = this.cells[ty * this.width + tx];
    return v <= 0 ? 0 : v / (1 + v);
  }

  save(file: string): boolean {
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      const idx: number[] = [];
      const val: number[] = [];
      const pidx: number[] = [];
      const pval: number[] = [];
      for (let i = 0; i < this.cells.length; i++) {
        const c = this.cells[i] * DECAY;
        if (c >= 0.01) {
          idx.push(i);
          val.push(Number(c.toFixed(3)));
        }
        const p = this.passes[i] * DECAY;
        if (p >= 0.05) {
          pidx.push(i);
          pval.push(Number(p.toFixed(2)));
        }
      }

      const cidx: number[] = [];
      const cval: number[] = [];
      for (const i of [...this.ctx.keys()].sort((a, b) => a - b)) {
        if (this.cells[i] * DECAY < 0.01) continue;
        const row = this.ctx.get(i)!;
        const out: number[] = [];
        let any = false;
        for (let k = 0; k < CTX_BUCKETS; k++) {
          const c = row[k] * DECAY;
          out.push(c >= 0.01 ? Number(c.toFixed(3)) : 0);
          if (c >= 0.01) any = true;
        }
        if (!any) continue;
        cidx.push(i);
        cval.push(...out);
      }
      mkdirSync(dirname(file), { recursive: true });

      try {
        const body: Record<string, unknown> = { key: this.key, width: this.width, height: this.height, events: this.events, idx, val, pidx, pval };
        if (cidx.length > 0) {
          body.cb = CTX_BUCKETS;
          body.cidx = cidx;
          body.cval = cval;
        }
        writeFileSync(tmp, JSON.stringify(body));
        renameSync(tmp, file);
      } catch (e) {
        try {
          rmSync(tmp, { force: true });
        } catch {

        }
        throw e;
      }
      for (let i = 0; i < this.cells.length; i++) {
        this.cells[i] *= DECAY;
        if (this.cells[i] < 0.01) this.cells[i] = 0;
        this.passes[i] *= DECAY;
        if (this.passes[i] < 0.05) this.passes[i] = 0;
      }
      for (const [i, row] of this.ctx) {
        let any = false;
        for (let k = 0; k < CTX_BUCKETS; k++) {
          row[k] *= DECAY;
          if (row[k] < 0.01) row[k] = 0;
          else any = true;
        }
        if (!any || this.cells[i] <= 0) this.ctx.delete(i);
      }
      return true;
    } catch {

      return false;
    }
  }

  static load(file: string, width: number, height: number, key?: string): FreezeMemory {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as {
        width?: number;
        height?: number;
        key?: unknown;
        events?: number;
        idx?: number[];
        val?: number[];
        pidx?: number[];
        pval?: number[];
        cb?: unknown;
        cidx?: unknown;
        cval?: unknown;
      };
      if (raw.width !== width || raw.height !== height || !Array.isArray(raw.idx) || !Array.isArray(raw.val)) {
        return new FreezeMemory(width, height, undefined, undefined, key);
      }
      if (key !== undefined && raw.key !== key) return new FreezeMemory(width, height, undefined, undefined, key);

      const fill = (into: Float32Array, idx: unknown, val: unknown): void => {
        if (!Array.isArray(idx) || !Array.isArray(val)) return;
        for (let k = 0; k < idx.length; k++) {
          const i = idx[k];
          const v = val[k];
          if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= into.length) continue;

          if (typeof v !== "number" || !Number.isFinite(Math.fround(v)) || v < 0) continue;
          into[i] = v;
        }
      };
      const cells = new Float32Array(width * height);
      fill(cells, raw.idx, raw.val);
      const passes = new Float32Array(width * height);
      fill(passes, raw.pidx, raw.pval);
      const mem = new FreezeMemory(width, height, cells, passes, key);
      mem.events = typeof raw.events === "number" && Number.isFinite(raw.events) && raw.events >= 0 ? raw.events : 0;

      if (raw.cb === CTX_BUCKETS && Array.isArray(raw.cidx) && Array.isArray(raw.cval) && raw.cval.length === raw.cidx.length * CTX_BUCKETS) {
        const cval = raw.cval as unknown[];
        for (let k = 0; k < raw.cidx.length; k++) {
          const i: unknown = raw.cidx[k];
          if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= cells.length || cells[i] <= 0) continue;
          const row = new Float32Array(CTX_BUCKETS);
          let ok = true;
          for (let b = 0; b < CTX_BUCKETS; b++) {
            const v = cval[k * CTX_BUCKETS + b];
            if (typeof v !== "number" || !Number.isFinite(Math.fround(v)) || v < 0) {
              ok = false;
              break;
            }
            row[b] = v;
          }
          if (ok) mem.ctx.set(i, row);
        }
      }
      return mem;
    } catch {
      return new FreezeMemory(width, height, undefined, undefined, key);
    }
  }
}
