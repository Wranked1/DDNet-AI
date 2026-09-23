import * as fs from "node:fs";
import type { Rng } from "./rng.ts";

export type MlpShape = { inputs: number; hidden: number[]; outputs: number };

export function paramCount(shape: MlpShape): number {
  const sizes = [shape.inputs, ...shape.hidden, shape.outputs];
  let count = 0;
  for (let i = 0; i < sizes.length - 1; i++) {
    count += sizes[i] * sizes[i + 1] + sizes[i + 1];
  }
  return count;
}

type LayerInfo = { wOffset: number; bOffset: number; nIn: number; nOut: number };

export class Mlp {
  readonly shape: MlpShape;
  readonly params: Float64Array;
  private readonly layers: LayerInfo[];
  private readonly scratch: Float64Array[];

  constructor(shape: MlpShape, params?: Float64Array) {
    const expected = paramCount(shape);
    if (params !== undefined && params.length !== expected) {
      throw new Error(`Mlp: params length ${params.length} does not match expected ${expected}`);
    }
    this.shape = shape;
    this.params = params ?? new Float64Array(expected);

    const sizes = [shape.inputs, ...shape.hidden, shape.outputs];
    this.layers = [];
    let offset = 0;
    for (let i = 0; i < sizes.length - 1; i++) {
      const nIn = sizes[i];
      const nOut = sizes[i + 1];
      const wOffset = offset;
      offset += nIn * nOut;
      const bOffset = offset;
      offset += nOut;
      this.layers.push({ wOffset, bOffset, nIn, nOut });
    }
    this.scratch = sizes.slice(1).map((n) => new Float64Array(n));
  }

  forward(input: Float64Array, out?: Float64Array): Float64Array {
    let activation: Float64Array = input;
    const lastIndex = this.layers.length - 1;
    for (let li = 0; li <= lastIndex; li++) {
      const layer = this.layers[li];
      const isLast = li === lastIndex;
      const dst = isLast && out !== undefined ? out : this.scratch[li];
      for (let j = 0; j < layer.nOut; j++) {
        let sum = this.params[layer.bOffset + j];
        const rowBase = layer.wOffset + j * layer.nIn;
        for (let i = 0; i < layer.nIn; i++) {
          sum += this.params[rowBase + i] * activation[i];
        }
        dst[j] = isLast ? sum : Math.tanh(sum);
      }
      activation = dst;
    }
    return out !== undefined ? activation : Float64Array.from(activation);
  }

  backward(input: Float64Array, target: Float64Array, grad: Float64Array): number {
    if (grad.length !== this.params.length) {
      throw new Error(`Mlp.backward: grad length ${grad.length} does not match ${this.params.length}`);
    }

    const out = this.forward(input);
    const acts: Float64Array[] = [input, ...this.scratch];

    let loss = 0;

    let delta = new Float64Array(this.shape.outputs);
    for (let j = 0; j < out.length; j++) {
      const r = out[j] - target[j];
      delta[j] = r;
      loss += 0.5 * r * r;
    }

    for (let li = this.layers.length - 1; li >= 0; li--) {
      const layer = this.layers[li];
      const a = acts[li];
      const next = new Float64Array(layer.nIn);
      for (let j = 0; j < layer.nOut; j++) {
        const d = delta[j];
        if (d === 0) continue;
        const rowBase = layer.wOffset + j * layer.nIn;
        grad[layer.bOffset + j] += d;
        for (let i = 0; i < layer.nIn; i++) {
          grad[rowBase + i] += d * a[i];
          next[i] += d * this.params[rowBase + i];
        }
      }
      if (li > 0) {

        const below = acts[li];
        for (let i = 0; i < next.length; i++) next[i] *= 1 - below[i] * below[i];
      }
      delta = next;
    }
    return loss;
  }

  setParams(p: Float64Array): void {
    if (p.length !== this.params.length) {
      throw new Error(`Mlp.setParams: length ${p.length} does not match expected ${this.params.length}`);
    }
    this.params.set(p);
  }

  toJSON(): { shape: MlpShape; params: number[] } {
    return { shape: this.shape, params: Array.from(this.params) };
  }

  static fromJSON(o: unknown): Mlp {
    if (typeof o !== "object" || o === null) {
      throw new Error("Mlp.fromJSON: expected an object");
    }
    const obj = o as { shape?: unknown; params?: unknown };
    const shape = obj.shape as MlpShape | undefined;
    if (
      !shape ||
      typeof shape.inputs !== "number" ||
      !Array.isArray(shape.hidden) ||
      typeof shape.outputs !== "number"
    ) {
      throw new Error("Mlp.fromJSON: invalid shape");
    }
    if (!Array.isArray(obj.params)) {
      throw new Error("Mlp.fromJSON: invalid params");
    }
    const expected = paramCount(shape);
    if (obj.params.length !== expected) {
      throw new Error(`Mlp.fromJSON: params length ${obj.params.length} does not match expected ${expected}`);
    }
    return new Mlp(shape, Float64Array.from(obj.params as number[]));
  }
}

export function initParams(shape: MlpShape, rng: Rng): Float64Array {
  const sizes = [shape.inputs, ...shape.hidden, shape.outputs];
  const params = new Float64Array(paramCount(shape));
  let offset = 0;
  for (let i = 0; i < sizes.length - 1; i++) {
    const nIn = sizes[i];
    const nOut = sizes[i + 1];
    const scale = Math.sqrt(2 / (nIn + nOut));
    for (let j = 0; j < nIn * nOut; j++) {
      params[offset++] = rng.nextGaussian() * scale;
    }
    for (let j = 0; j < nOut; j++) {
      params[offset++] = 0;
    }
  }
  return params;
}

export function saveMlp(path: string, m: Mlp): void {
  fs.writeFileSync(path, JSON.stringify(m.toJSON()));
}

export function loadMlp(path: string): Mlp {
  const raw = fs.readFileSync(path, "utf8");
  return Mlp.fromJSON(JSON.parse(raw));
}
