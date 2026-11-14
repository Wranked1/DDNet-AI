import type { Collision } from "../core/collision.ts";
import type { PlayerInput } from "../core/types.ts";
import { FLAT_ALIVE, FLAT_FREEZE_LEFT, FLAT_POS_X, FLAT_POS_Y, FLAT_STRIDE, FLAT_VEL_X, FLAT_VEL_Y, SimWorld } from "../core/world.ts";
import { TELEPORT_PX, goalReached, lateHashU } from "./pathfind.ts";
import { SERVER_TICK_SPEED, TUNING } from "../core/tuning.ts";
import type { PathGoal } from "./pathfind.ts";

export const FREEZE_OK_TICKS = 60;

export const FREEZE_WAIT_SLACK_TICKS = 10;
export const FREEZE_WAIT_OK_TICKS = 3 * SERVER_TICK_SPEED + FREEZE_WAIT_SLACK_TICKS;

export const JITTER_COPIES = 8;
export const JITTER_RATE = 0.3;

export const GRACE_TICKS = 30;

const teleported = (dx: number, dy: number): boolean => Math.abs(dx) > TELEPORT_PX || Math.abs(dy) > TELEPORT_PX;

export function teleportsIn(states: Float64Array, ticks: number): number {
  let n = 0;
  for (let t = 1; t <= ticks; t++) {
    const o = t * FLAT_STRIDE;
    const p = (t - 1) * FLAT_STRIDE;
    if (teleported(states[o + FLAT_POS_X] - states[p + FLAT_POS_X], states[o + FLAT_POS_Y] - states[p + FLAT_POS_Y])) n++;
  }
  return n;
}

const LANDING_PX = 1.5;
function rampOf(vx: number, vy: number): number {
  const value = Math.hypot(vx, vy) * 50;
  if (value < TUNING.velrampStart) return 1;
  return 1 / Math.pow(TUNING.velrampCurvature, (value - TUNING.velrampStart) / TUNING.velrampRange);
}
export function landingsAt(states: Float64Array, ticks: number, x: number, y: number): number {
  const tx = Math.floor(x / 32);
  const ty = Math.floor(y / 32);
  let n = 0;
  for (let t = 1; t <= ticks; t++) {
    const o = t * FLAT_STRIDE;
    const p = (t - 1) * FLAT_STRIDE;
    const vx = states[o + FLAT_VEL_X];
    const vy = states[o + FLAT_VEL_Y];
    if (Math.abs(states[o + FLAT_POS_X] - vx * rampOf(vx, vy) - x) > LANDING_PX || Math.abs(states[o + FLAT_POS_Y] - vy - y) > LANDING_PX) continue;
    if (Math.floor(states[p + FLAT_POS_X] / 32) !== tx || Math.floor(states[p + FLAT_POS_Y] / 32) !== ty) n++;
  }
  return n;
}

export function judgeStates(_col: Collision, states: Float64Array, ticks: number, teleports = 0, freezeOk = FREEZE_OK_TICKS): { ok: boolean; why: string } {
  let frozenRun = 0;
  let jumps = 0;
  let why = "";
  for (let t = 1; t <= ticks; t++) {
    const o = t * FLAT_STRIDE;
    const p = (t - 1) * FLAT_STRIDE;
    if (states[o + FLAT_ALIVE] !== 1 && why === "") why = "died";
    if (teleported(states[o + FLAT_POS_X] - states[p + FLAT_POS_X], states[o + FLAT_POS_Y] - states[p + FLAT_POS_Y]) && ++jumps > teleports && why === "") why = "teleported";
    frozenRun = states[o + FLAT_FREEZE_LEFT] > 0 ? frozenRun + 1 : 0;
    if (frozenRun > freezeOk && why === "") why = "froze";
  }
  return { ok: why === "", why: why === "" ? "pass" : why };
}

export function jitterHolds(col: Collision, goal: PathGoal, start: Float64Array, inputs: readonly PlayerInput[], copies = JITTER_COPIES, teleports = 0, freezeOk = FREEZE_OK_TICKS): number {
  const sim = new SimWorld(col, { respawnDelayTicks: 1_000_000, pickups: true });
  sim.addTee(0, { x: 0, y: 0 });
  let ok = 0;
  const last = inputs.length - 1;
  if (last < 0) return 0;
  for (let j = 0; j < copies; j++) {
    sim.loadFlat(0, start, 0);
    let frozenRun = 0;
    let jumps = 0;
    let px = start[FLAT_POS_X];
    let py = start[FLAT_POS_Y];
    let arrived = false;
    for (let t = 0; t <= last + GRACE_TICKS; t++) {

      const late = t % 2 === 0 && t > 0 && lateHashU(j, t >> 1) < JITTER_RATE;
      const k = Math.min(last, late ? t - 1 : t);
      sim.setInput(0, inputs[k]);
      sim.step();
      if (!sim.isAlive(0)) break;
      const c = sim.coreOf(0);
      if (c === undefined) break;
      if (teleported(c.pos.x - px, c.pos.y - py) && ++jumps > teleports) break;
      px = c.pos.x;
      py = c.pos.y;
      const frozen = sim.freezeTicksOf(0) > 0;
      frozenRun = frozen ? frozenRun + 1 : 0;
      if (frozenRun > freezeOk) break;
      if (goalReached(col, goal, c.pos.x, c.pos.y, c.vel.x, frozen)) {
        arrived = true;
        break;
      }
    }
    if (arrived) ok++;
  }
  return ok / copies;
}
