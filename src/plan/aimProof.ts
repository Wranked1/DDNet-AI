import { blankTeeState } from "../core/types.ts";
import type { PlayerInput, TeeState } from "../core/types.ts";
import type { SimState, SimWorld } from "../core/world.ts";

let scratch: SimState | undefined;
const buf: TeeState = blankTeeState();
const traceA: number[] = [];
const traceB: number[] = [];

function play(sim: SimWorld, ids: readonly number[], selfId: number, enemyId: number, enemyInput: PlayerInput, input: PlayerInput, ticks: number, trace: number[]): boolean {
  trace.length = 0;
  let out = false;
  sim.setInput(selfId, input);
  sim.setInput(enemyId, enemyInput);
  for (let k = 0; k < ticks; k++) {
    sim.step();

    for (const id of ids) {
      const t = sim.readTee(id, buf)!;
      if (id === selfId && (!t.alive || t.frozen)) out = true;
      trace.push(t.alive ? 1 : 0, t.frozen ? 1 : 0, t.pos.x, t.pos.y, t.vel.x, t.vel.y, t.hookState, t.hookedPlayer, t.hookPos.x, t.hookPos.y, t.hookDir.x, t.hookDir.y, t.jumpsLeft);
    }
  }
  return out;
}

export function aimIsFree(
  sim: SimWorld,
  selfId: number,
  enemyId: number,
  enemyInput: PlayerInput,
  others: readonly { id: number }[],
  planned: PlayerInput,
  cosmetic: { x: number; y: number },
  ticks: number,
): boolean {
  if (sim.getTee(selfId) === undefined) return false;
  const ids: number[] = [selfId];
  if (sim.getTee(enemyId) !== undefined) ids.push(enemyId);
  for (const o of others) if (o.id !== selfId && o.id !== enemyId && sim.getTee(o.id) !== undefined) ids.push(o.id);
  scratch = sim.saveState(scratch);
  try {
    if (play(sim, ids, selfId, enemyId, enemyInput, planned, ticks, traceA)) return false;
    sim.restoreState(scratch);
    if (play(sim, ids, selfId, enemyId, enemyInput, { ...planned, targetX: cosmetic.x, targetY: cosmetic.y }, ticks, traceB)) return false;
  } finally {
    sim.restoreState(scratch);
  }
  if (traceA.length !== traceB.length) return false;
  for (let i = 0; i < traceA.length; i++) if (!Object.is(traceA[i], traceB[i])) return false;
  return true;
}

export const PROOF_EXTRA_TICKS = 8;

export function proofFor(
  sim: SimWorld,
  selfId: number,
  enemyId: number,
  enemyInput: PlayerInput,
  others: readonly { id: number }[],
  planned: PlayerInput,
  lag: number,
): (x: number, y: number) => boolean {
  return (x, y) => aimIsFree(sim, selfId, enemyId, enemyInput, others, planned, { x, y }, lag + PROOF_EXTRA_TICKS);
}
