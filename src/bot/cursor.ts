import { Rng } from "../nn/rng.ts";
import type { PlayerInput, TeeState } from "../core/types.ts";
import { HOOK_GRABBED } from "../core/characterCore.ts";

export const PRE_PIN_TICKS = 0;

export const APPROACH_MAX_TICKS = 30;

export const ARRIVE_TICKS = 8;

export const DEADZONE_DEG = 12;

export const REMAIN_PER_TICK = 0.4;

export const MAX_STEP_DEG = 175;

export const CURSOR_LEN = 300;

export const LAST_THROW_MAX_TICKS = 150;

export const OPPONENT_REST_PX = 640;

export const VELOCITY_REST_SPEED = 1.5;

export const DWELL_MEDIAN_TICKS = 20;
export const DWELL_SIGMA = 0.75;
export const DWELL_MIN_TICKS = 6;
export const DWELL_MAX_TICKS = 50;

export const HOLD_KEEP_DEG = 15;

export const LEAD_MEAN_TICKS = 3.5;
export const LEAD_MAX_TICKS = 16;

export const REST_WEIGHTS = { lastThrow: 0.3, opponent: 0.25, velocity: 0.1, forward: 0.35 };
export const REST_NOISE_DEG = 4;
export const FORWARD_TILT_DEG = 20;

export const CURSOR_FIX = { pressOnlyKeyNear: true, hookRiseNarrow: true, flickLead: true, stableTarget: true, minJerk: true, leadFlick: true };

export const HOOK_RISE_PIN_DECISIONS = 2;

export const FLICK_MIN_TICKS = 3;
export const FLICK_MAX_TICKS = 4;
export const FLICK_DEG_PER_TICK = 60;
export const FLICK_ARRIVE_TICKS = 2;

export const LEAD_FLICK_TICKS = 2;
export const LEAD_HEAD_TICKS = 2;
export const LEAD_START_TICKS = 5;

export const LEAD_STALE_TICKS = 6;

export const SWITCH_DEG = 30;
export const SWITCH_TICKS = 6;
export const DRIFT_DEG = 2;

export const FREE_BASE_TICKS = 2;
export const FREE_DEG_PER_TICK = 35;
export const CORRECTION_SHARE = 0.4;
export const CORRECTION_MIN_MOVE_DEG = 25;
export const CORRECTION_MIN_DEG = 3;
export const CORRECTION_MAX_DEG = 8;

export const RESEG_DEG = 12;
export const SEG_HEAD_TICKS = 1;

const DEG = Math.PI / 180;
const WEAPON_HAMMER = 0;

export type CursorProducer = "planner" | "nav" | "wander" | "other";

export type CursorTee = {
  alive: boolean;
  frozen: boolean;
  freezeTicksLeft: number;
  hookState: number;
  activeWeapon: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export type CursorHint = { keyAt: number; keyKind: number; keyAim: number; keyTick: number; stamp?: number; gated?: boolean; kept?: boolean };

export type CursorCtx = {

  tick: number;

  lag: number;
  producer: CursorProducer;

  replaced?: boolean;
  tee: CursorTee | null;

  enemy: { x: number; y: number; alive: boolean; hooked: boolean } | null;
  hint: CursorHint | null;

  free: ((x: number, y: number) => boolean) | null;

  prevHook?: number;
};

export type CursorShape = { x: number; y: number; pinned: boolean; reason: string };

export function cursorTee(t: TeeState): CursorTee {
  return { alive: t.alive, frozen: t.frozen, freezeTicksLeft: t.freezeTicksLeft, hookState: t.hookState, activeWeapon: t.activeWeapon, x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y };
}

export function hintFrom(info: { searched: boolean; keyAt: number; keyKind: number; keyAim: number; keyTick: number; gated?: boolean; keyKept?: boolean }, tick: number, prev: CursorHint | null): CursorHint | null {
  if (!info.searched) return prev;
  if (prev !== null && prev.stamp === info.keyTick) return prev;
  return info.keyAt >= 0
    ? { keyAt: info.keyAt, keyKind: info.keyKind, keyAim: info.keyAim, keyTick: tick, stamp: info.keyTick, ...(info.gated === true ? { gated: true } : {}), ...(info.keyKept === true ? { kept: true } : {}) }
    : null;
}

const wrap = (a: number): number => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const minJerk = (u: number): number => {
  const x = clamp(u, 0, 1);
  return x * x * x * (10 - 15 * x + 6 * x * x);
};

type Seg = { a0: number; t0: number; dur: number; tgt: number; final: number };

export class HumanCursor {
  readonly enabled: boolean;
  private rng: Rng;

  ang = 0;
  private target = 0;

  private base = 0;
  private holdUntil = 0;
  private restKind = "none";

  private approaching = false;
  private lead = 0;

  private seg: Seg | null = null;
  private focusSet = false;
  private pendAng = 0;
  private pendSince = -1;
  private lastThrowAng = 0;
  private lastThrowTick = -1e9;

  private decisions = 0;
  private lastTick = -1;
  private lastFire = 0;
  private lastFireChange = -1e9;
  private lastHook = 0;
  private lastHookRise = -1e9;

  private lastHookRiseTick = -1e9;
  private lastDir = 1;
  private started = false;

  constructor(seed: number, enabled = true) {
    this.rng = new Rng(seed);
    this.enabled = enabled;
  }

  reseed(seed: number): void {
    this.rng = new Rng(seed);
  }

  get restTarget(): string {
    return this.restKind;
  }

  shape(planned: PlayerInput, ctx: CursorCtx): CursorShape {
    if (!this.enabled) return { x: planned.targetX, y: planned.targetY, pinned: true, reason: "off" };
    const t = ctx.tick;
    const aim = Math.atan2(planned.targetY, planned.targetX);
    const none = planned.targetX === 0 && planned.targetY === 0;
    const dt = this.lastTick < 0 ? 2 : clamp(t - this.lastTick, 1, 6);
    this.lastTick = t;

    const idx = this.decisions++;
    if (!this.started) {
      this.started = true;
      this.lastFire = planned.fire;
      this.lastHook = planned.hook;

      this.lastFireChange = idx;
      this.lastHookRise = idx;
      this.lastHookRiseTick = ctx.tick;
    }
    const fireChanged = planned.fire !== this.lastFire;
    if (fireChanged) this.lastFireChange = idx;
    const hookRose = planned.hook !== 0 && (this.lastHook === 0 || ctx.prevHook === 0);
    if (hookRose) {
      this.lastHookRise = idx;
      this.lastHookRiseTick = ctx.tick;
    }
    this.lastFire = planned.fire;
    this.lastHook = planned.hook;
    if (planned.direction !== 0) this.lastDir = planned.direction;

    const press = hookRose || (fireChanged && (planned.fire & 1) !== 0);
    const pin = this.pinReason(planned, ctx, none, idx, press);
    if (pin !== null) {

      if (press) {
        this.lastThrowAng = aim;
        this.lastThrowTick = t;
        this.park(aim, t);
      } else if (t < this.holdUntil && !none && Math.abs(wrap(aim - this.target)) <= HOLD_KEEP_DEG * DEG) {

        this.ang = aim;
        this.holdUntil = Math.max(this.holdUntil, t + DWELL_MIN_TICKS);

        this.seg = null;
      } else this.snap(none ? this.ang : aim);
      return { x: planned.targetX, y: planned.targetY, pinned: true, reason: pin };
    }

    const [cx, cy] = this.move(planned, ctx, dt);

    const relaxed = planned.hook !== 0;
    if (relaxed && (ctx.free === null || !ctx.free(cx, cy))) {
      this.snap(aim);
      return { x: planned.targetX, y: planned.targetY, pinned: true, reason: "hook-held" };
    }
    return { x: cx, y: cy, pinned: false, reason: relaxed ? "free" : "cosmetic" };
  }

  private pinReason(planned: PlayerInput, ctx: CursorCtx, none: boolean, idx: number, press: boolean): string | null {
    const tee = ctx.tee;
    if (tee === null || !tee.alive) return "dead";
    if (none) return "noaim";

    if (ctx.producer === "other") return "producer";
    if (ctx.replaced === true) return "guard";

    if (idx - this.lastFireChange <= 2 || (planned.fire & 1) !== 0) return "fire";
    if (tee.activeWeapon !== WEAPON_HAMMER || planned.wantedWeapon > WEAPON_HAMMER + 1 || planned.nextWeapon !== 0 || planned.prevWeapon !== 0) return "weapon";

    const sinceRise = idx - this.lastHookRise;

    if (CURSOR_FIX.hookRiseNarrow ? sinceRise <= HOOK_RISE_PIN_DECISIONS || (sinceRise <= 3 && (tee.hookState !== HOOK_GRABBED || ctx.tick - this.lastHookRiseTick <= 2 * ctx.lag)) : sinceRise <= 3) return "hook-rise";
    if (planned.hook !== 0 && tee.hookState !== HOOK_GRABBED) return "hook-throw";

    const h = ctx.hint;
    if (h !== null && h.keyAt >= 0 && h.keyAt - (ctx.tick - h.keyTick) <= PRE_PIN_TICKS && (press || !CURSOR_FIX.pressOnlyKeyNear)) return "key-near";

    if (tee.frozen && tee.freezeTicksLeft <= ctx.lag + 8) return "thaw";
    return null;
  }

  private snap(aim: number): void {

    this.pendSince = -1;
    this.ang = aim;
    this.seg = null;
    this.approaching = false;
    this.restKind = "pinned";

    if (CURSOR_FIX.stableTarget && this.focusSet) return;
    this.target = aim;
    this.base = NaN;
    this.holdUntil = -1e9;
  }

  private park(aim: number, tick: number): void {
    this.snap(aim);
    this.base = aim;
    this.target = aim;
    this.focusSet = true;
    this.pendSince = -1;
    this.holdUntil = tick + this.dwell();
    this.restKind = "throw";
  }

  private dwell(): number {
    return clamp(Math.round(Math.exp(Math.log(DWELL_MEDIAN_TICKS) + DWELL_SIGMA * this.rng.nextGaussian())), DWELL_MIN_TICKS, DWELL_MAX_TICKS);
  }

  private move(planned: PlayerInput, ctx: CursorCtx, dt: number): [number, number] {
    const t = ctx.tick;
    let want: number | null = null;

    if (ctx.producer === "wander") {
      want = Math.atan2(planned.targetY, planned.targetX);
      this.restKind = "wander";
      this.base = NaN;
      this.focusSet = false;
      this.holdUntil = -1e9;
      this.approaching = false;
    }

    const h = ctx.hint;
    let flick = false;
    let fast = false;
    if (CURSOR_FIX.flickLead) {

      const left = want === null && h !== null && h.keyAt >= 0 ? h.keyAt - (t - h.keyTick) : NaN;

      fast = CURSOR_FIX.leadFlick && left >= 1 && h!.gated !== true && h!.kept === true;
      if (left >= -LEAD_STALE_TICKS && left <= (fast ? LEAD_START_TICKS : FLICK_MAX_TICKS + FLICK_ARRIVE_TICKS + 1)) {
        const a = Math.abs(wrap(h!.keyAim - this.ang)) / DEG;
        if (fast || left <= this.flickTicks(a, false) + FLICK_ARRIVE_TICKS + 1) {
          want = h!.keyAim;
          flick = true;
          this.restKind = "lead";
        }
      } else this.approaching = false;
    } else {
      const keyAt = want === null && h !== null && h.keyAt >= 0 ? h.keyAt - (t - h.keyTick) : -1;
      if (keyAt >= 0 && keyAt <= APPROACH_MAX_TICKS) {
        if (!this.approaching) {
          this.approaching = true;
          this.lead = clamp(Math.round(-Math.log(1 - this.rng.nextFloat()) * LEAD_MEAN_TICKS), 0, LEAD_MAX_TICKS);
        }
        if (keyAt <= ARRIVE_TICKS + this.lead) want = h!.keyAim;
      } else this.approaching = false;
    }
    if (want === null) {
      if (CURSOR_FIX.stableTarget) want = this.stableRest(planned, ctx);
      else {

        if (t >= this.holdUntil) {
          const cand = this.drawRest(planned, ctx);
          if (Number.isNaN(this.base) || Math.abs(wrap(cand - this.base)) > DEADZONE_DEG * DEG) {
            this.base = cand;
            this.target = wrap(cand + (this.rng.nextFloat() * 2 - 1) * REST_NOISE_DEG * DEG);
          }
          this.holdUntil = t + this.dwell();
        }
        want = this.target;
      }
    }
    if (CURSOR_FIX.minJerk || flick) this.jerkTo(want, t, flick, fast && flick, dt);
    else {

      this.seg = null;
      const e = wrap(want - this.ang);
      if (Math.abs(e) < 0.5 * DEG) this.ang = want;
      else {
        const step = e * (1 - Math.pow(REMAIN_PER_TICK, dt));
        const cap = MAX_STEP_DEG * DEG * dt;
        this.ang = wrap(this.ang + clamp(step, -cap, cap));
      }
    }

    let x = Math.round(Math.cos(this.ang) * CURSOR_LEN);
    let y = Math.round(Math.sin(this.ang) * CURSOR_LEN);
    if (x === 0 && y === 0) x = CURSOR_LEN;
    return [x, y];
  }

  private flickTicks(deg: number, fast: boolean): number {
    if (fast) return LEAD_FLICK_TICKS;
    return clamp(FREE_BASE_TICKS + deg / FLICK_DEG_PER_TICK, FLICK_MIN_TICKS, FLICK_MAX_TICKS);
  }

  private jerkTo(want: number, t: number, flick: boolean, fast: boolean, dt: number): void {
    let s = this.seg;
    if (s !== null && Math.abs(wrap(want - s.final)) <= RESEG_DEG * DEG) {
      if (s.final === s.tgt) s.tgt = want;
      s.final = want;
    } else {
      const a = Math.abs(wrap(want - this.ang)) / DEG;
      if (a < 0.5) {
        this.ang = want;
        this.seg = null;
        return;
      }
      let tgt = want;
      let dur = this.flickTicks(a, fast);
      if (!flick) {
        dur = FREE_BASE_TICKS + a / FREE_DEG_PER_TICK;

        if (a > CORRECTION_MIN_MOVE_DEG && this.rng.nextFloat() < CORRECTION_SHARE) {
          const off = (CORRECTION_MIN_DEG + (CORRECTION_MAX_DEG - CORRECTION_MIN_DEG) * this.rng.nextFloat()) * DEG;
          tgt = wrap(want + (this.rng.nextFloat() < 0.5 ? -off : off));
        }
      }
      s = this.seg = { a0: this.ang, t0: t - (fast ? LEAD_HEAD_TICKS : SEG_HEAD_TICKS), dur, tgt, final: want };
    }
    if (t >= s.t0 + s.dur && s.tgt !== s.final) {
      const a = Math.abs(wrap(s.final - s.tgt)) / DEG;
      s = this.seg = { a0: s.tgt, t0: s.t0 + s.dur, dur: FREE_BASE_TICKS + a / FREE_DEG_PER_TICK, tgt: s.final, final: s.final };
    }
    const next = wrap(s.a0 + wrap(s.tgt - s.a0) * minJerk((t - s.t0) / s.dur));
    const cap = MAX_STEP_DEG * DEG * dt;
    this.ang = wrap(this.ang + clamp(wrap(next - this.ang), -cap, cap));
  }

  private stableRest(planned: PlayerInput, ctx: CursorCtx): number {
    const t = ctx.tick;
    const [cand, kind] = this.focus(planned, ctx);
    if (!this.focusSet) this.setBase(cand, kind, t);
    else if (Math.abs(wrap(cand - this.base)) > SWITCH_DEG * DEG) {
      if (this.pendSince < 0 || Math.abs(wrap(cand - this.pendAng)) > SWITCH_DEG * DEG) {
        this.pendSince = t;
        this.pendAng = cand;
      }
      if (t - this.pendSince >= SWITCH_TICKS) this.setBase(cand, kind, t);
    } else this.pendSince = -1;
    if (t >= this.holdUntil) {
      this.target = this.drifted();
      this.holdUntil = t + this.dwell();
    }
    return this.target;
  }

  private drifted(): number {
    return wrap(this.base + (this.rng.nextFloat() * 2 - 1) * DRIFT_DEG * DEG);
  }

  private setBase(cand: number, kind: string, t: number): void {
    this.base = cand;
    this.focusSet = true;
    this.restKind = kind;
    this.pendSince = -1;
    this.target = this.drifted();
    this.holdUntil = t + this.dwell();
  }

  private focus(planned: PlayerInput, ctx: CursorCtx): [number, string] {
    const tee = ctx.tee!;
    const en = ctx.enemy;
    if (en !== null && en.alive && Math.hypot(en.x - tee.x, en.y - tee.y) <= OPPONENT_REST_PX) return [Math.atan2(en.y - tee.y, en.x - tee.x), "opponent"];
    if (ctx.tick - this.lastThrowTick <= LAST_THROW_MAX_TICKS) return [this.lastThrowAng, "lastThrow"];
    const dir = planned.direction !== 0 ? planned.direction : this.lastDir;
    return [dir > 0 ? -FORWARD_TILT_DEG * DEG : Math.PI + FORWARD_TILT_DEG * DEG, "forward"];
  }

  private drawRest(planned: PlayerInput, ctx: CursorCtx): number {
    const tee = ctx.tee!;
    const kinds: Array<[string, number, number]> = [];
    if (ctx.tick - this.lastThrowTick <= LAST_THROW_MAX_TICKS) kinds.push(["lastThrow", REST_WEIGHTS.lastThrow, this.lastThrowAng]);
    const en = ctx.enemy;
    if (en !== null && en.alive && !en.hooked && Math.hypot(en.x - tee.x, en.y - tee.y) <= OPPONENT_REST_PX) {
      kinds.push(["opponent", REST_WEIGHTS.opponent, Math.atan2(en.y - tee.y, en.x - tee.x)]);
    }
    if (Math.hypot(tee.vx, tee.vy) > VELOCITY_REST_SPEED) kinds.push(["velocity", REST_WEIGHTS.velocity, Math.atan2(tee.vy, tee.vx)]);
    const dir = planned.direction !== 0 ? planned.direction : this.lastDir;
    kinds.push(["forward", REST_WEIGHTS.forward, dir > 0 ? -FORWARD_TILT_DEG * DEG : Math.PI + FORWARD_TILT_DEG * DEG]);
    let total = 0;
    for (const k of kinds) total += k[1];
    let pick = this.rng.nextFloat() * total;
    let chosen = kinds[kinds.length - 1];
    for (const k of kinds) {
      pick -= k[1];
      if (pick < 0) {
        chosen = k;
        break;
      }
    }
    this.restKind = chosen[0];
    return chosen[2];
  }
}
