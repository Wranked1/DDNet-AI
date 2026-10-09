import { Rng } from "../nn/rng.ts";
import { PHYSICAL_SIZE, SERVER_TICK_SPEED, TILE_TELECHECKIN, TILE_TELECHECKINEVIL, TILE_TELEIN, TILE_TELEINEVIL, TUNING } from "../core/tuning.ts";
import { HOOK_IDLE } from "../core/characterCore.ts";
import { WEAPON_GUN, WEAPON_HAMMER } from "../core/types.ts";
import type { Collision } from "../core/collision.ts";

const TILE_PX = 32;

export const HANDS_FEATURES = { swap: true, idleFire: true };

export const FLAG_JETPACK = 1 << 1;
export const FLAG_SUPER = 1 << 5;
export const FLAG_TELEGUN_GUN = 1 << 11;
export const FLAG_WEAPON_HAMMER = 1 << 14;
export const FLAG_WEAPON_GUN = 1 << 15;
export const FLAG_WEAPON_NINJA = 1 << 19;

export const HANDS_HAMMER_REACH_PX = PHYSICAL_SIZE * 0.75 + PHYSICAL_SIZE * 1.5 + 8;
export const HANDS_REACH_PX = TUNING.hookLength + HANDS_HAMMER_REACH_PX;

export const HANDS_START_MARGIN_PX = 60;

export const HANDS_LATENCY_TICKS = 6;
export const HANDS_RELOAD_TICKS = 6;

export const HANDS_ACCEL = 1.5;

export const HANDS_GATE = { ropeReach: true, accel: HANDS_ACCEL };

export const HANDS_PLAN_TICKS = 60;

export const HANDS_QUIET_TICKS = 50;

export const HANDS_SWAP_PER_MIN = 6;
export const HANDS_IDLE_HAMMER_PER_MIN = 3;

export const HANDS_HOLD_MEDIAN_TICKS = 14;
export const HANDS_HOLD_SIGMA = 1.1;
export const HANDS_HOLD_MIN_TICKS = 6;
export const HANDS_HOLD_MAX_TICKS = 120;

export const HANDS_SHOT_WEIGHTS: readonly number[] = [30, 35, 20, 15];
export const HANDS_SHOT_FIRST_TICKS: readonly [number, number] = [4, 14];
export const HANDS_SHOT_GAP_TICKS: readonly [number, number] = [10, 28];

export const HANDS_SINCE_ATTACK_TICKS = 30;

export const HANDS_RAY_CLEAR_PX = 120;

export const HANDS_SETTLE_TICKS = 24;

export const HANDS_GAP_MAX_TICKS = 10;

export const HANDS_RESUME_MAX_TICKS = 30;
export const HANDS_TICKS_PER_MINUTE = 3000;

export type HandsProducer = "planner" | "nav" | "wander" | "other";

export type HandsTee = {
  alive: boolean;
  frozen: boolean;
  hookState: number;
  hookedPlayer: number;
  activeWeapon: number;

  flags: number | undefined;
  x: number;
  y: number;
  vx: number;
  vy: number;

  sinceAttack: number;
};
export type HandsOther = { x: number; y: number; vx: number; vy: number };
export type HandsPoint = { x: number; y: number };

export type HandsCtx = {
  tick: number;
  lag: number;
  duel: boolean;
  producer: HandsProducer;
  self: HandsTee;

  others: readonly HandsOther[];

  teleIns: readonly HandsPoint[];

  planned: { fire: number; hook: number; wantedWeapon: number };
  prevFire: number;

  keyIn: number | null;

  rayClear: (() => boolean) | null;
};

export type HandsOut = { weapon: number; press: boolean };
const NOTHING: HandsOut = { weapon: 0, press: false };

export function handsWindow(lag: number): number {
  return Math.max(0, lag) + HANDS_LATENCY_TICKS + HANDS_RELOAD_TICKS;
}

export function handsRoomOk(self: { x: number; y: number; vx: number; vy: number }, others: readonly HandsOther[], lag: number, extraPx = 0): boolean {
  const w = handsWindow(lag);
  for (const o of others) {
    const dx = o.x - self.x;
    const dy = o.y - self.y;
    const d = Math.hypot(dx, dy);

    const closing = d > 0 ? Math.max(0, -((o.vx - self.vx) * dx + (o.vy - self.vy) * dy) / d) : 0;
    const reach = closing * w + HANDS_GATE.accel * w * w;
    if (d - reach < (HANDS_GATE.ropeReach ? HANDS_REACH_PX : HANDS_HAMMER_REACH_PX) + extraPx) return false;
  }
  return true;
}

const SPAWN_TILE_FIRST = 192;
const SPAWN_TILE_LAST = 194;

export function handsSpots(collision: Collision): HandsOther[] {
  const out: HandsOther[] = [];
  const front = collision.frontIndex;
  const isSpawn = (t: number): boolean => t >= SPAWN_TILE_FIRST && t <= SPAWN_TILE_LAST;
  for (let i = 0; i < collision.tiles.length; i++) {
    if (!isSpawn(collision.tiles[i]) && (front === undefined || !isSpawn(front[i]))) continue;
    out.push({ x: (i % collision.width) * TILE_PX + TILE_PX / 2, y: Math.trunc(i / collision.width) * TILE_PX + TILE_PX / 2, vx: 0, vy: 0 });
  }
  if (collision.hasTele()) {
    for (let n = 1; n < 256; n++) {
      for (const p of collision.teleOutsFor(n)) out.push({ x: p.x, y: p.y, vx: 0, vy: 0 });
      for (const p of collision.teleCheckOutsFor(n)) out.push({ x: p.x, y: p.y, vx: 0, vy: 0 });
    }
  }
  return out;
}

const TELE_IN_TYPES: ReadonlySet<number> = new Set([TILE_TELEINEVIL, TILE_TELEIN, TILE_TELECHECKIN, TILE_TELECHECKINEVIL]);

export function handsTeleIns(collision: Collision): HandsPoint[] {
  const out: HandsPoint[] = [];
  const types = collision.teleType;
  if (types === undefined) return out;
  for (let i = 0; i < types.length; i++) {
    const t = types[i];
    if (!TELE_IN_TYPES.has(t)) continue;
    if ((t === TILE_TELEIN || t === TILE_TELEINEVIL) && collision.teleOutsFor(collision.teleNumberAtIndex(i)).length === 0) continue;
    out.push({ x: (i % collision.width) * TILE_PX + TILE_PX / 2, y: Math.trunc(i / collision.width) * TILE_PX + TILE_PX / 2 });
  }
  return out;
}

export function handsTeleClear(self: { x: number; y: number; vx: number; vy: number }, teleIns: readonly HandsPoint[], lag: number, extraPx = 0): boolean {
  if (teleIns.length === 0) return true;
  const w = handsWindow(lag);
  const r = Math.hypot(self.vx, self.vy) * w + HANDS_GATE.accel * w * w + PHYSICAL_SIZE + extraPx;
  const r2 = r * r;
  for (const p of teleIns) {
    const dx = p.x - self.x;
    const dy = p.y - self.y;
    if (dx * dx + dy * dy < r2) return false;
  }
  return true;
}

function weaponsOk(flags: number | undefined): boolean {
  if (flags === undefined) return false;
  if ((flags & FLAG_WEAPON_HAMMER) === 0 || (flags & FLAG_WEAPON_GUN) === 0) return false;
  return (flags & (FLAG_JETPACK | FLAG_SUPER | FLAG_TELEGUN_GUN | FLAG_WEAPON_NINJA)) === 0;
}

export type HandsStats = { ticks: number; calmTicks: number; episodes: number; aborts: number; shots: number; idleSwings: number; switches: number };

export class HumanHands {
  private rng: Rng;
  private readonly swapPerMin: number;
  private readonly hammerPerMin: number;

  private holding = false;
  private holdUntil = 0;
  private nextShotAt = -1;
  private shotsLeft = 0;
  private lastTick = -1;

  private busyTick = -1;
  private episodeEnd = -1e9;
  readonly stats: HandsStats = { ticks: 0, calmTicks: 0, episodes: 0, aborts: 0, shots: 0, idleSwings: 0, switches: 0 };

  constructor(seed: number, opts: { swapPerMin?: number; hammerPerMin?: number } = {}) {
    this.rng = new Rng(seed >>> 0);
    this.swapPerMin = opts.swapPerMin ?? HANDS_SWAP_PER_MIN;
    this.hammerPerMin = opts.hammerPerMin ?? HANDS_IDLE_HAMMER_PER_MIN;
  }

  get wishing(): boolean {
    return this.holding;
  }

  settling(tick: number): boolean {
    return this.holding || (tick >= this.episodeEnd && tick - this.episodeEnd <= HANDS_SETTLE_TICKS);
  }

  interrupt(tick: number): void {
    this.endEpisode(tick, true);
    this.busyTick = tick;
  }

  reset(): void {
    this.holding = false;
    this.nextShotAt = -1;
    this.shotsLeft = 0;
    this.lastTick = -1;
    this.busyTick = -1;
    this.episodeEnd = -1e9;
  }

  private ready(c: HandsCtx): boolean {
    const s = c.self;
    if (c.duel || !s.alive || s.frozen) return false;
    if (c.producer === "other") return false;
    if (s.hookState !== HOOK_IDLE || s.hookedPlayer >= 0) return false;
    if (c.planned.hook !== 0 || (c.planned.fire & 1) !== 0 || (c.prevFire & 1) !== 0 || c.planned.fire !== c.prevFire) return false;
    if (c.planned.wantedWeapon > WEAPON_HAMMER + 1) return false;
    if (c.keyIn !== null && c.keyIn <= HANDS_PLAN_TICKS) return false;
    if (!weaponsOk(s.flags)) return false;
    return s.activeWeapon === WEAPON_HAMMER || s.activeWeapon === WEAPON_GUN;
  }

  step(c: HandsCtx): HandsOut {
    if (this.lastTick >= 0 && c.tick < this.lastTick) this.reset();

    if (this.lastTick < 0) this.busyTick = c.tick;
    const since = this.lastTick < 0 ? 0 : c.tick - this.lastTick;
    const dt = Math.min(HANDS_GAP_MAX_TICKS, Math.max(0, since));
    this.lastTick = c.tick;
    this.stats.ticks += dt;
    if (!HANDS_FEATURES.swap && !HANDS_FEATURES.idleFire) {
      this.endEpisode(c.tick, false);
      return NOTHING;
    }

    const calm = since <= HANDS_RESUME_MAX_TICKS && this.ready(c) && handsRoomOk(c.self, c.others, c.lag) && handsTeleClear(c.self, c.teleIns, c.lag);
    if (!calm) this.busyTick = c.tick;
    if (this.holding) {
      if (!calm) {
        this.endEpisode(c.tick, true);
        return NOTHING;
      }
      this.stats.calmTicks += dt;
      return this.hold(c);
    }
    if (!calm) return NOTHING;
    this.stats.calmTicks += dt;

    if (dt === 0 || c.tick - this.busyTick < HANDS_QUIET_TICKS || c.self.sinceAttack <= HANDS_SINCE_ATTACK_TICKS) return NOTHING;
    if (c.self.activeWeapon !== WEAPON_HAMMER || !handsRoomOk(c.self, c.others, c.lag, HANDS_START_MARGIN_PX) || !handsTeleClear(c.self, c.teleIns, c.lag, HANDS_START_MARGIN_PX)) return NOTHING;
    const roll = (perMin: number): boolean => this.rng.nextFloat() < 1 - Math.exp((-perMin * dt) / HANDS_TICKS_PER_MINUTE);
    if (HANDS_FEATURES.swap && roll(this.swapPerMin)) {
      this.begin(c.tick);
      return { weapon: WEAPON_GUN + 1, press: false };
    }
    if (HANDS_FEATURES.idleFire && roll(this.hammerPerMin)) {
      this.stats.idleSwings++;
      return { weapon: 0, press: true };
    }
    return NOTHING;
  }

  private begin(tick: number): void {
    this.holding = true;
    this.stats.episodes++;
    this.stats.switches++;
    const z = this.rng.nextGaussian();
    const len = Math.round(Math.exp(Math.log(HANDS_HOLD_MEDIAN_TICKS) + HANDS_HOLD_SIGMA * z));
    this.holdUntil = tick + Math.min(HANDS_HOLD_MAX_TICKS, Math.max(HANDS_HOLD_MIN_TICKS, len));
    let total = 0;
    for (const w of HANDS_SHOT_WEIGHTS) total += w;
    let pick = this.rng.nextFloat() * total;
    this.shotsLeft = 0;
    for (let i = 0; i < HANDS_SHOT_WEIGHTS.length; i++) {
      pick -= HANDS_SHOT_WEIGHTS[i];
      if (pick < 0) {
        this.shotsLeft = i;
        break;
      }
    }
    if (!HANDS_FEATURES.idleFire) this.shotsLeft = 0;
    this.nextShotAt = -1;
  }

  private hold(c: HandsCtx): HandsOut {
    const inHand = c.self.activeWeapon === WEAPON_GUN;
    if (inHand && this.shotsLeft > 0) {
      if (this.nextShotAt < 0) this.nextShotAt = c.tick + this.between(HANDS_SHOT_FIRST_TICKS);
      if (c.tick >= this.nextShotAt && c.self.sinceAttack > HANDS_RELOAD_TICKS + 4 && c.rayClear !== null && c.rayClear()) {
        this.shotsLeft--;
        this.stats.shots++;
        this.nextShotAt = c.tick + this.between(HANDS_SHOT_GAP_TICKS);

        this.holdUntil = Math.max(this.holdUntil, c.tick + HANDS_RELOAD_TICKS + 2);
        return { weapon: WEAPON_GUN + 1, press: true };
      }

      if (c.tick < this.holdUntil + HANDS_SHOT_GAP_TICKS[1]) return { weapon: WEAPON_GUN + 1, press: false };
    }
    if (c.tick >= this.holdUntil && c.self.sinceAttack > HANDS_RELOAD_TICKS) {
      this.endEpisode(c.tick, false);
      return NOTHING;
    }
    return { weapon: WEAPON_GUN + 1, press: false };
  }

  private between(r: readonly [number, number]): number {
    return r[0] + Math.floor(this.rng.nextFloat() * (r[1] - r[0] + 1));
  }

  private endEpisode(tick: number, abort: boolean): void {
    if (this.holding) {
      this.holding = false;
      this.episodeEnd = tick;
      this.stats.switches++;
      if (abort) this.stats.aborts++;
    }
    this.nextShotAt = -1;
    this.shotsLeft = 0;
  }
}

type Moving = { x: number; y: number; vx?: number; vy?: number };
export function bulletLineClear(
  from: Moving,
  ax: number,
  ay: number,
  others: readonly Moving[],
  wallAt: (a: { x: number; y: number }, b: { x: number; y: number }) => { x: number; y: number } | null,
  lead = 0,
): boolean {
  const n = Math.hypot(ax, ay);
  if (n === 0) return false;
  const dx = ax / n;
  const dy = ay / n;
  const sx0 = from.x + (from.vx ?? 0) * lead;
  const sy0 = from.y + (from.vy ?? 0) * lead;
  const curvature = TUNING.gunCurvature / 10000;
  const at = (tick: number): { x: number; y: number } => {
    const d = (tick / SERVER_TICK_SPEED) * TUNING.gunSpeed;
    return { x: sx0 + dx * d, y: sy0 + dy * d + curvature * d * d };
  };

  const seg = (a: { x: number; y: number }, b: { x: number; y: number }, px: number, py: number): number => {
    const sx = b.x - a.x;
    const sy = b.y - a.y;
    const len2 = sx * sx + sy * sy;
    const u = len2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * sx + (py - a.y) * sy) / len2)) : 0;
    return Math.hypot(px - (a.x + sx * u), py - (a.y + sy * u));
  };

  const fall = (t: number): number => (TUNING.gravity * t * (t + 1)) / 2;
  const life = Math.trunc(SERVER_TICK_SPEED * TUNING.gunLifetime);
  let a = at(0);
  for (let k = 1; k <= life; k++) {
    const hit = wallAt(a, at(k));
    const b = hit ?? at(k);
    for (const o of others) {
      const vx = o.vx ?? 0;
      const vy = o.vy ?? 0;
      const falls = o.vx !== undefined || o.vy !== undefined;
      for (let t = lead + k - 1; t <= lead + k; t++) {
        const x = o.x + vx * t;
        const y = o.y + vy * t;
        if (seg(a, b, x, y) < HANDS_RAY_CLEAR_PX || (falls && seg(a, b, x, y + fall(t)) < HANDS_RAY_CLEAR_PX)) return false;
      }
    }
    if (hit !== null) return true;
    a = b;
  }
  return true;
}
