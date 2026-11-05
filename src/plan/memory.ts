import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";

const TILE_PX = 32;

const SPREAD = 0.4;

const DECAY = 0.97;

export class FreezeMemory {
  readonly width: number;
  readonly height: number;
  private readonly cells: Float32Array;

  private readonly passes: Float32Array;
  private events = 0;

  readonly key: string | undefined;

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

  note(x: number, y: number): void {
    const tx = Math.trunc(x / TILE_PX);
    const ty = Math.trunc(y / TILE_PX);
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return;
    this.events++;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const nx = tx + ox;
        const ny = ty + oy;
        if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) continue;
        this.cells[ny * this.width + nx] += ox === 0 && oy === 0 ? 1 : SPREAD;
      }
    }
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
      mkdirSync(dirname(file), { recursive: true });

      try {
        writeFileSync(tmp, JSON.stringify({ key: this.key, width: this.width, height: this.height, events: this.events, idx, val, pidx, pval }));
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
      return mem;
    } catch {
      return new FreezeMemory(width, height, undefined, undefined, key);
    }
  }
}
