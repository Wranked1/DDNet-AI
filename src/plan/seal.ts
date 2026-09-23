import type { Collision } from "../core/collision.ts";
import type { SimWorld } from "../core/world.ts";
import type { PlayerInput, TeeState } from "../core/types.ts";
import { emptyInput } from "../core/types.ts";
import { PHYSICAL_SIZE, TUNING } from "../core/tuning.ts";
import type { Vec2 } from "../core/vmath.ts";

const HALF = PHYSICAL_SIZE / 2;

export function touchesFreeze(collision: Collision, x: number, y: number): boolean {
  const h = HALF - 1;
  for (const [dx, dy] of [
    [0, 0],
    [-h, -h],
    [h, -h],
    [-h, h],
    [h, h],
  ]) {
    if (collision.isFreeze(x + dx, y + dy) || collision.isDeath(x + dx, y + dy)) return true;
  }
  return false;
}

export function restsInFreeze(collision: Collision, pos: Vec2, vel: Vec2): number {
  let x = pos.x;
  let y = pos.y;
  let vx = vel.x;
  let vy = vel.y;
  for (let t = 0; t < 60; t++) {
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
      break;
    }
    if (vy < 0 && collision.isSolid(x, ny - HALF)) vy = 0;
    else y = ny;
    if (collision.isDeath(x, y)) return 1;
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

const SEAL_TICKS = 90;

export function sealedIn(world: SimWorld, id: number, state: TeeState, held: PlayerInput): boolean {
  for (const other of world.allTees()) if (other.id !== id) world.removeTee(other.id);
  if (world.getTee(id) === undefined) world.addTee(id, state.pos);
  world.applyTeeState(id, state);
  const start = world.saveState();
  try {

    const tries = state.frozen && state.freezeTicksLeft >= SEAL_TICKS ? [held] : escapes(held);
    for (const input of tries) {
      world.restoreState(start);
      for (let t = 0; t < SEAL_TICKS; t++) {

        const now = input.jump !== 0 && t % 2 === 1 ? { ...input, jump: 0 } : input;
        world.setInput(id, now);
        world.step();
      }
      const end = world.getTee(id);
      if (end === undefined || !end.alive) continue;
      if (!end.frozen || !touchesFreeze(world.collision, end.pos.x, end.pos.y)) return false;
    }
    return true;
  } finally {
    world.restoreState(start);
  }
}
