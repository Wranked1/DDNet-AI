import { Rng } from "../nn/rng.ts";

export const EMOTICON = { oop: 0, exclamation: 1, hearts: 2, drop: 3, dotdot: 4, music: 5, sorry: 6, splat: 9, zzz: 12, wtf: 13, eyes: 14, question: 15 } as const;
export type EmoteName = keyof typeof EMOTICON;

export type EmoteEvent = "freeze" | "thaw" | "kill" | "death" | "otherKill" | "given";
export type EmoteContext = EmoteEvent | "none";

export const EMOTE_PROBABILITY: Readonly<Record<EmoteEvent, number>> = { freeze: 0.2, thaw: 0.12, kill: 0.15, death: 0.12, otherKill: 0.08, given: 0.12 };

export const DELAY_MEDIAN_TICKS = 50;
export const DELAY_SIGMA = 0.68;
export const DELAY_SIGMA_LOW = 0.94;
export const DELAY_MIN_TICKS = 8;
export const DELAY_MAX_TICKS = 150;

export const IDLE_RATE_MEDIAN = 2.2;
export const IDLE_RATE_SIGMA = 0.7;
export const IDLE_RATE_MIN = 0.3;
export const IDLE_RATE_MAX = 8;

export const IDLE_NEAR_PX = 400;
export const IDLE_MID_PX = 900;
export const IDLE_WEIGHT_NEAR = 1;
export const IDLE_WEIGHT_MID = 0.35;
export const IDLE_WEIGHT_FAR = 0.12;
export const TICKS_PER_MINUTE = 3000;

export const IDLE_GAP_MAX_TICKS = 50;

export const EMOTE_WEIGHTS: Readonly<Record<EmoteContext, readonly (readonly [EmoteName, number])[]>> = {
  none: [["hearts", 22], ["zzz", 19], ["question", 12], ["exclamation", 11], ["eyes", 8], ["wtf", 6], ["dotdot", 5], ["music", 4], ["oop", 4], ["splat", 4], ["drop", 3], ["sorry", 2]],
  freeze: [["hearts", 19], ["question", 18], ["zzz", 12], ["drop", 11], ["eyes", 11], ["exclamation", 8], ["wtf", 7], ["dotdot", 6], ["oop", 4], ["music", 4]],
  thaw: [["question", 23], ["zzz", 21], ["exclamation", 19], ["hearts", 17], ["eyes", 7], ["wtf", 6], ["dotdot", 4], ["music", 3]],
  death: [["question", 32], ["wtf", 11], ["zzz", 11], ["hearts", 10], ["eyes", 9], ["sorry", 8], ["dotdot", 7], ["exclamation", 6], ["drop", 6]],
  kill: [["zzz", 40], ["hearts", 25], ["question", 12], ["splat", 10], ["eyes", 5], ["exclamation", 4], ["music", 4]],
  otherKill: [["question", 50], ["eyes", 20], ["wtf", 15], ["exclamation", 15]],

  given: [["zzz", 25], ["hearts", 25], ["question", 12], ["eyes", 10], ["splat", 10], ["exclamation", 8], ["music", 5], ["oop", 5]],
};

export type EmoterState = { alive: boolean; frozen: boolean; nearest?: number };
type Pending = { kind: EmoteContext; due: number; emoticon: number };

export function idleWeight(nearest: number | undefined): number {
  if (nearest === undefined || nearest < IDLE_NEAR_PX) return IDLE_WEIGHT_NEAR;
  return nearest < IDLE_MID_PX ? IDLE_WEIGHT_MID : IDLE_WEIGHT_FAR;
}

export class HumanEmoter {

  readonly idleRate: number;
  private rng: Rng;
  private pendingEmote: Pending | null = null;
  private lastTick = -1;
  private readonly sink: (emoticon: number) => void;

  constructor(seed: number, sink: (emoticon: number) => void, opts: { idleRate?: number } = {}) {
    this.sink = sink;
    this.rng = new Rng(seed);
    const drawn = Math.min(IDLE_RATE_MAX, Math.max(IDLE_RATE_MIN, Math.exp(Math.log(IDLE_RATE_MEDIAN) + IDLE_RATE_SIGMA * this.rng.nextGaussian())));
    this.idleRate = opts.idleRate ?? drawn;
  }

  get pending(): Readonly<Pending> | null {
    return this.pendingEmote;
  }

  event(kind: EmoteEvent, tick: number): void {

    const waiting = this.pendingEmote;
    if (waiting !== null && waiting.kind !== kind) return;
    if (this.rng.nextFloat() >= EMOTE_PROBABILITY[kind]) return;
    this.schedule(kind, tick);
  }

  tick(tick: number, state: EmoterState): void {

    if (this.lastTick >= 0 && tick < this.lastTick) this.pendingEmote = null;
    const dt = this.lastTick < 0 ? 0 : Math.min(IDLE_GAP_MAX_TICKS, Math.max(0, tick - this.lastTick));
    this.lastTick = tick;
    const p = this.pendingEmote;
    if (p !== null && tick >= p.due) {
      this.pendingEmote = null;

      if (tick - p.due <= DELAY_MAX_TICKS && !this.stale(p.kind, state)) this.sink(p.emoticon);
    }

    if (this.pendingEmote === null && state.alive && dt > 0 && this.rng.nextFloat() < 1 - Math.exp((-this.idleRate * idleWeight(state.nearest) * dt) / TICKS_PER_MINUTE)) {
      this.schedule("none", tick);
    }
  }

  private schedule(kind: EmoteContext, tick: number): void {
    const z = this.rng.nextGaussian();
    const delay = Math.min(DELAY_MAX_TICKS, Math.max(DELAY_MIN_TICKS, Math.round(Math.exp(Math.log(DELAY_MEDIAN_TICKS) + (z < 0 ? DELAY_SIGMA_LOW : DELAY_SIGMA) * z))));
    this.pendingEmote = { kind, due: tick + delay, emoticon: this.choose(kind) };
  }

  private stale(kind: EmoteContext, s: EmoterState): boolean {
    switch (kind) {
      case "freeze":
        return !s.frozen || !s.alive;
      case "thaw":
        return s.frozen;
      case "none":
        return !s.alive;
      default:
        return false;
    }
  }

  private choose(kind: EmoteContext): number {
    const table = EMOTE_WEIGHTS[kind];
    let total = 0;
    for (const [, w] of table) total += w;
    let pick = this.rng.nextFloat() * total;
    for (const [name, w] of table) {
      pick -= w;
      if (pick < 0) return EMOTICON[name];
    }
    return EMOTICON[table[table.length - 1][0]];
  }
}
