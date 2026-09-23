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
