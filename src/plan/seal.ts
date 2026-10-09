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

export function restsInFreeze(collision: Collision, pos: Vec2, vel: Vec2): number {
  let x = pos.x;
  let y = pos.y;
  let vx = vel.x;
  let vy = vel.y;
  const tele = collision.hasTele();

  const through = (): number => {
    const tp = collision.teleAt(x, y);
    if (tp.number === 0) return 0;
    if (tp.type === TILE_TELEIN || tp.type === TILE_TELEINEVIL) {
      const outs = collision.teleOutsFor(tp.number);
      if (outs.length === 0) return 0;
      x = outs[0].x;
      y = outs[0].y;
      if (tp.type === TILE_TELEINEVIL) {
        vx = 0;
        vy = 0;
      }
      return 1;
    }
    return tp.type === TILE_TELECHECKIN || tp.type === TILE_TELECHECKINEVIL ? -1 : 0;
  };
  for (let t = 0; t < REST_TICKS; t++) {
    const grounded = collision.isSolid(x - HALF + 1, y + HALF + 1) || collision.isSolid(x + HALF - 1, y + HALF + 1);
    if (grounded && vy >= 0) break;
    vy += TUNING.gravity;
    vx *= TUNING.airFriction;
    const nx = x + vx;
    if (collision.isSolid(nx + Math.sign(vx) * HALF, y)) vx = 0;
    else x = nx;
    const ny = y + vy;
    if (vy > 0 && (collision.isSolid(x - HALF + 1, ny + HALF) || collision.isSolid(x + HALF - 1, ny + HALF))) {

      y = Math.floor((ny + HALF) / 32) * 32 - HALF - 0.01;
      vy = 0;
      if (!tele) break;
      const moved = through();
      if (moved < 0) return 0;
      if (moved === 0) break;
      continue;
    }
    if (vy < 0 && collision.isSolid(x, ny - HALF)) vy = 0;
    else y = ny;
    if (collision.isDeath(x, y)) return 1;
    if (tele && through() < 0) return 0;
  }
  return touchesFreeze(collision, x, y) ? 1 : 0;
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
      let reached = !passive || !state.frozen;
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
      if (!end.frozen || !touchesFreeze(world.collision, end.pos.x, end.pos.y)) return false;
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
