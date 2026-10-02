import type { PlanStep } from "./planner.ts";
import { TUNING } from "../core/tuning.ts";

const HOOK_LENGTH = TUNING.hookLength;

const THROW_RANGE_NEARNESS = 0.4;

export type ThrowSituation = {
  separation: number;
  enemyHazardNearness: number;
  meFrozen: boolean;
  enemyFrozen: boolean;
  enemyAlive: boolean;
};

export function throwWorthTrying(s: ThrowSituation): boolean {
  if (s.meFrozen || s.enemyFrozen || !s.enemyAlive) return false;
  if (s.separation > HOOK_LENGTH) return false;
  return s.enemyHazardNearness >= THROW_RANGE_NEARNESS;
}

export function throwLines(steps: number, at: number): PlanStep[][] {
  const mk = (fn: (s: number) => PlanStep): PlanStep[] => Array.from({ length: steps }, (_, s) => fn(s));

  const releases = [2, Math.max(3, Math.round(steps / 3)), Math.max(5, Math.round((2 * steps) / 3)), steps];
  const mid = Math.max(3, Math.round(steps / 3));
  const lines: PlanStep[][] = [];
  for (const dir of [-1, 1]) {
    for (const r of releases) {

      lines.push(mk((s) => ({ dir, jump: 0, hook: s < r ? 1 : 0, fire: 0, aim: at })));
    }

    lines.push(mk((s) => ({ dir, jump: s === 1 ? 1 : 0, hook: s < mid + 1 ? 1 : 0, fire: 0, aim: at })));

    lines.push(mk((s) => ({ dir, jump: 0, hook: s < mid ? 1 : 0, fire: s >= mid ? 1 : 0, aim: at })));
  }
  return lines;
}

export function frozenThrowWorthTrying(s: ThrowSituation): boolean {
  if (s.meFrozen || !s.enemyFrozen || !s.enemyAlive) return false;
  return s.separation <= HOOK_LENGTH;
}

export function frozenThrowLines(steps: number, at: number): PlanStep[][] {
  const mk = (fn: (s: number) => PlanStep): PlanStep[] => Array.from({ length: steps }, (_, s) => fn(s));
  const lines = throwLines(steps, at);
  const third = Math.max(3, Math.round(steps / 3));
  for (const dir of [-1, 0, 1]) {

    for (const h of [2, 3, 5]) {
      if (h + 1 >= steps) continue;
      lines.push(mk((s) => ({ dir, jump: s === h - 1 ? 1 : 0, hook: s < h ? 1 : 0, fire: s === h || s === h + 1 ? 1 : 0, aim: at })));
    }

    lines.push(mk((s) => ({ dir, jump: s === 0 || s === third ? 1 : 0, hook: s < third + 1 ? 1 : 0, fire: 0, aim: at })));
  }
  return lines;
}

const WALL_SWING_JUMPS = [4, 6];
const WALL_SWING_FLIP = 11;
const WALL_SWING_RELEASES = [18, 22, 26];

export function wallSwingLines(steps: number, stepTicks: readonly number[], at: number, wallDir: number): PlanStep[][] {
  if (wallDir === 0 || steps <= 0 || stepTicks.length === 0) return [];
  const start: number[] = [];
  for (let s = 0, t = 0; s < steps; s++) {
    start.push(t);
    t += stepTicks[Math.min(s, stepTicks.length - 1)];
  }
  const covers = (s: number, tick: number): boolean => start[s] <= tick && tick < (s + 1 < steps ? start[s + 1] : Infinity);
  const jumpSteps: number[] = [];
  for (const tick of WALL_SWING_JUMPS) {
    const s = start.findIndex((_, i) => covers(i, tick));
    if (s >= 0 && !jumpSteps.includes(s)) jumpSteps.push(s);
  }
  const d = Math.sign(wallDir);
  const lines: PlanStep[][] = [];
  for (const j of jumpSteps) {
    for (const r of WALL_SWING_RELEASES) {
      lines.push(
        start.map((t, s) => ({ dir: t < WALL_SWING_FLIP ? d : -d, jump: s === j ? 1 : 0, hook: t < r ? 1 : 0, fire: 0, aim: at })),
      );
    }
  }
  return lines;
}

const AIR_CHAIN_PLANS: readonly (readonly [number, number])[] = [
  [6, 10],
  [8, 12],
  [8, 14],
  [11, 16],
];
const AIR_CHAIN_JUMP_PLANS = [2, 3];

export function airChainLines(steps: number, stepTicks: readonly number[], at: number, wallDir: number, airJump = true): PlanStep[][] {
  if (wallDir === 0 || steps <= 0 || stepTicks.length === 0) return [];
  const start: number[] = [];
  for (let s = 0, t = 0; s < steps; s++) {
    start.push(t);
    t += stepTicks[Math.min(s, stepTicks.length - 1)];
  }
  const d = Math.sign(wallDir);
  const line = (flip: number, release: number, jumpAt: number): PlanStep[] =>
    start.map((t, s) => ({ dir: t < flip ? d : -d, jump: s === jumpAt ? 1 : 0, hook: t < release ? 1 : 0, fire: 0, aim: at }));
  const lines = AIR_CHAIN_PLANS.map(([flip, release]) => line(flip, release, -1));
  if (airJump && steps > 1) for (const i of AIR_CHAIN_JUMP_PLANS) lines.push(line(AIR_CHAIN_PLANS[i][0], AIR_CHAIN_PLANS[i][1], 1));
  return lines;
}
