import type { Collision } from "../core/collision.ts";
import type { SimWorld } from "../core/world.ts";
import type { PlayerInput, TeeState } from "../core/types.ts";
import { emptyInput } from "../core/types.ts";
import { PHYSICAL_SIZE, TILE_TELECHECKIN, TILE_TELECHECKINEVIL, TILE_TELEIN, TILE_TELEINEVIL, TUNING } from "../core/tuning.ts";
import type { Vec2 } from "../core/vmath.ts";

const HALF = PHYSICAL_SIZE / 2;

const SEAL_TICKS = 90;
const REST_TICKS = 60;

export function touchesFreeze(collision: Collision, x: number, y: number): boolean {
  if (collision.isHazard(x, y)) return true;
  const d = PHYSICAL_SIZE / 3;
  return collision.isDeath(x + d, y - d) || collision.isDeath(x + d, y + d) || collision.isDeath(x - d, y - d) || collision.isDeath(x - d, y + d);
}

export function restsInFreeze(collision: Collision, pos: Vec2, vel: Vec2, anyExit = false): number {
  return frozenFlight(collision, pos.x, pos.y, vel.x, vel.y, REST_TICKS, 0, null, anyExit);
}

export type FrozenPath = { x: number[]; y: number[]; vx: number[]; vy: number[] };

export function frozenFlightPath(collision: Collision, pos: Vec2, vel: Vec2, ticks: number): FrozenPath {
  const rec: FrozenPath = { x: [pos.x], y: [pos.y], vx: [vel.x], vy: [vel.y] };
  frozenFlight(collision, pos.x, pos.y, vel.x, vel.y, ticks, 0, rec);
  return rec;
}

const EXIT_GROUP_TILES = 2;
const exitGroups = new WeakMap<Collision, Map<number, Vec2[]>>();
function teleExitGroups(collision: Collision, number: number, outs: readonly Vec2[]): Vec2[] {
  let byNumber = exitGroups.get(collision);
  if (byNumber === undefined) {
    byNumber = new Map();
    exitGroups.set(collision, byNumber);
  }
  const known = byNumber.get(number);
  if (known !== undefined) return known;
  const groups: Vec2[][] = [];
  for (const o of outs) {
    const near: Vec2[][] = groups.filter((g) => g.some((m) => Math.abs(m.x - o.x) <= EXIT_GROUP_TILES * 32 && Math.abs(m.y - o.y) <= EXIT_GROUP_TILES * 32));
    const merged: Vec2[] = [o];
    for (const g of near) {
      merged.push(...g);
      groups.splice(groups.indexOf(g), 1);
    }
    groups.push(merged);
  }

  const order = new Map(outs.map((o, i) => [o, i] as const));
  const reps = groups
    .map((g) => g.reduce((a, b) => (order.get(a)! <= order.get(b)! ? a : b)))
    .sort((a, b) => order.get(a)! - order.get(b)!);
  byNumber.set(number, reps);
  return reps;
}

function frozenFlight(collision: Collision, x0: number, y0: number, vx0: number, vy0: number, ticks: number, depth: number, rec: FrozenPath | null, anyExit = false): number {
  let x = x0;
  let y = y0;
  let vx = vx0;
  let vy = vy0;
  const tele = collision.hasTele();
  let branched = 0;

  const through = (left: number): number => {
    const tp = collision.teleAt(x, y);
    if (tp.number === 0) return 0;
    if (tp.type === TILE_TELEIN || tp.type === TILE_TELEINEVIL) {
      const outs = collision.teleOutsFor(tp.number);
      if (outs.length === 0) return 0;
      const evil = tp.type === TILE_TELEINEVIL;
      if (rec === null && depth < 2 && outs.length > 1) {
        const groups = teleExitGroups(collision, tp.number, outs);
        if (groups.length > 1) {

          let worst = anyExit ? 0 : 1;
          for (const g of groups) {
            const r = frozenFlight(collision, g.x, g.y, evil ? 0 : vx, evil ? 0 : vy, left, depth + 1, null, anyExit);
            if (anyExit ? r > worst : r < worst) worst = r;
            if (worst === (anyExit ? 1 : 0)) break;
          }
          branched = worst;
          return 2;
        }
      }
      x = outs[0].x;
      y = outs[0].y;
      if (evil) {
        vx = 0;
        vy = 0;
      }
      return 1;
    }
    return tp.type === TILE_TELECHECKIN || tp.type === TILE_TELECHECKINEVIL ? -1 : 0;
  };
  let written = 0;
  let res = -1;

  let rested = false;
  let t = 0;
  for (; t < ticks; t++) {
    const grounded = collision.isSolid(x - HALF + 1, y + HALF + 1) || collision.isSolid(x + HALF - 1, y + HALF + 1);
    if (grounded && vy >= 0) {
      rested = true;
      break;
    }
    vy += TUNING.gravity;
    vx *= TUNING.airFriction;
    const nx = x + vx;
    if (collision.isSolid(nx + Math.sign(vx) * HALF, y)) vx = 0;
    else x = nx;
    const ny = y + vy;
    if (vy > 0 && (collision.isSolid(x - HALF + 1, ny + HALF) || collision.isSolid(x + HALF - 1, ny + HALF))) {

      y = Math.floor((ny + HALF) / 32) * 32 - HALF - 0.01;
      vy = 0;
      if (!tele) {
        rested = true;
        break;
      }
      const moved = through(ticks - t - 1);
      if (moved === 2) {
        res = branched;
        break;
      }
      if (moved < 0) {
        res = 0;
        break;
      }
      if (moved === 0) {
        rested = true;
        break;
      }
      if (rec !== null) written = record(rec, written, t + 1, x, y, vx, vy);
      continue;
    }
    if (vy < 0 && collision.isSolid(x, ny - HALF)) vy = 0;
    else y = ny;
    if (collision.isDeath(x, y)) {
      res = 1;
      break;
    }
    if (tele) {
      const moved = through(ticks - t - 1);
      if (moved === 2) {
        res = branched;
        break;
      }
      if (moved < 0) {
        res = 0;
        break;
      }
    }
    if (rec !== null) written = record(rec, written, t + 1, x, y, vx, vy);
  }
  if (rec !== null) record(rec, written, ticks, x, y, rested ? 0 : vx, rested ? 0 : vy);
  return res >= 0 ? res : touchesFreeze(collision, x, y) ? 1 : 0;
}

function record(rec: FrozenPath, from: number, to: number, x: number, y: number, vx: number, vy: number): number {
  for (let i = from + 1; i <= to; i++) {
    rec.x[i] = x;
    rec.y[i] = y;
    rec.vx[i] = vx;
    rec.vy[i] = vy;
  }
  return Math.max(from, to);
}

function escapes(held: PlayerInput): PlayerInput[] {
  const out: PlayerInput[] = [held];
  for (const ax of [0, -1, 1]) {
    const e = emptyInput();
    e.jump = 1;
    e.hook = 1;
    e.direction = ax;
    e.targetX = ax * 200;
    e.targetY = -300;
    out.push(e);
  }
  return out;
}

export function sealedIn(world: SimWorld, id: number, state: TeeState, held: PlayerInput, passive = false): boolean {
  for (const other of world.allTees()) if (other.id !== id) world.removeTee(other.id);
  if (world.getTee(id) === undefined) world.addTee(id, state.pos);
  world.applyTeeState(id, state);
  const start = world.saveState();
  try {

    const tries = passive || (state.frozen && state.freezeTicksLeft >= SEAL_TICKS) ? [held] : escapes(held);
    for (const input of tries) {
      world.restoreState(start);
      let reached = !passive || !state.frozen || state.deepFrozen === true;
      for (let t = 0; t < SEAL_TICKS; t++) {

        const now = input.jump !== 0 && t % 2 === 1 ? { ...input, jump: 0 } : input;
        world.setInput(id, now);
        world.step();
        if (!reached && t < state.freezeTicksLeft) {
          const at = world.getTee(id);
          if (at !== undefined && at.alive && touchesFreeze(world.collision, at.pos.x, at.pos.y)) reached = true;
        }
      }
      const end = world.getTee(id);
      if (end === undefined || !end.alive) continue;
      if (!reached) return false;

      if (end.deepFrozen !== true && (!end.frozen || !touchesFreeze(world.collision, end.pos.x, end.pos.y))) return false;
    }
    return true;
  } finally {
    world.restoreState(start);
  }
}

export const HELD_HORIZON_TICKS = 250;

export type Forecast = {

  freeIn: number | null;

  died: boolean;

  steps: number;
};

export function forecastHeld(f: Forecast): boolean {
  return f.freeIn === null;
}

export function forecastOutTicks(f: Forecast, horizon: number): number {
  return f.freeIn === null ? horizon : Math.min(f.freeIn, horizon);
}

export function passiveForecast(world: SimWorld, id: number, state: TeeState | undefined, horizon: number): Forecast {
  for (const other of world.allTees()) if (other.id !== id) world.removeTee(other.id);
  if (state === undefined) return { freeIn: null, died: true, steps: 0 };
  if (world.getTee(id) === undefined) world.addTee(id, state.pos);
  world.applyTeeState(id, state);
  const start = world.getTee(id);
  if (start === undefined || !start.alive) return { freeIn: null, died: true, steps: 0 };
  if (!start.frozen) return { freeIn: 0, died: false, steps: 0 };

  const saved = world.saveState();
  try {
    world.setInput(id, emptyInput());
    let lastX = start.pos.x;
    let lastY = start.pos.y;
    let lastVx = start.vel.x;
    let lastVy = start.vel.y;
    for (let t = 0; t < horizon; t++) {
      world.step();
      const now = world.getTee(id);
      if (now === undefined || !now.alive) return { freeIn: null, died: true, steps: t + 1 };
      if (!now.frozen) return { freeIn: t + 1, died: false, steps: t + 1 };

      if (now.pos.x === lastX && now.pos.y === lastY && now.vel.x === lastVx && now.vel.y === lastVy && now.hookState <= 0) {
        if (now.deepFrozen === true || touchesFreeze(world.collision, now.pos.x, now.pos.y)) return { freeIn: null, died: false, steps: t + 1 };
        const free = t + 1 + Math.max(0, now.freezeTicksLeft);
        return { freeIn: free < horizon ? free : null, died: false, steps: t + 1 };
      }
      lastX = now.pos.x;
      lastY = now.pos.y;
      lastVx = now.vel.x;
      lastVy = now.vel.y;
    }
    return { freeIn: null, died: false, steps: horizon };
  } finally {
    world.restoreState(saved);
  }
}
