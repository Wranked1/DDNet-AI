import { HOOK_FLYING, HOOK_GRABBED, HOOK_IDLE } from "../core/characterCore.ts";
import { PHYSICAL_SIZE, TUNING } from "../core/tuning.ts";

export type HookSnap = {
  tick: number;
  alive: boolean;
  x: number;
  y: number;
  hookState: number;
  hookX: number;
  hookY: number;

  hookDx: number;
  hookDy: number;
  hookedPlayer: number;
  hookTick?: number;

  endless: boolean;
};

export const HOOK_FIT_PX = 12;
export const HOOK_APART_PX = 40;
export const HOOK_EDGE_PX = 6;
export const HOOK_MAX_GAP = 4;

const HOOK_START = PHYSICAL_SIZE * 1.5;
const HOOK_STEP = TUNING.hookFireSpeed;

export function hookLaunchTick(prev: HookSnap, cur: HookSnap, allowGrabbed = true): number | null {
  const gap = cur.tick - prev.tick;
  if (gap < 1 || gap > HOOK_MAX_GAP || !prev.alive || !cur.alive || prev.hookState !== HOOK_IDLE) return null;
  const len = Math.hypot(cur.hookDx, cur.hookDy);
  if (!(len > 0.5)) return null;
  const dx = cur.hookDx / len;
  const dy = cur.hookDy / len;

  const qx = (k: number): number => prev.x + ((cur.x - prev.x) * (gap - k)) / gap;
  const qy = (k: number): number => prev.y + ((cur.y - prev.y) * (gap - k)) / gap;
  if (cur.hookState === HOOK_FLYING) {
    let best = -1;
    let bestMiss = Infinity;
    let nextMiss = Infinity;
    for (let k = 1; k <= gap; k++) {
      const reach = HOOK_START + HOOK_STEP * k;
      const miss = Math.hypot(cur.hookX - (qx(k) + dx * reach), cur.hookY - (qy(k) + dy * reach));
      if (miss < bestMiss) {
        nextMiss = bestMiss;
        bestMiss = miss;
        best = k;
      } else if (miss < nextMiss) nextMiss = miss;
    }
    if (best < 0 || bestMiss > HOOK_FIT_PX || nextMiss < HOOK_APART_PX) return null;
    return cur.tick - best + 1;
  }
  if (!allowGrabbed || cur.hookState !== HOOK_GRABBED || cur.hookedPlayer !== -1 || cur.endless) return null;
  const held = cur.hookTick;
  if (typeof held !== "number" || held < 1 || held > gap) return null;

  const grab = cur.tick - held + 1;
  let found: number | null = null;
  for (let k = 1; k <= gap; k++) {
    const launch = cur.tick - k + 1;
    if (grab < launch) continue;

    const steps = grab - launch + 1;
    const rx = cur.hookX - qx(k);
    const ry = cur.hookY - qy(k);
    const along = rx * dx + ry * dy;
    const off = Math.abs(rx * dy - ry * dx);
    const from = HOOK_START + HOOK_STEP * (steps - 1);
    const to = HOOK_START + HOOK_STEP * steps;
    if (off > HOOK_FIT_PX || along <= from + HOOK_EDGE_PX || along > to - HOOK_EDGE_PX) continue;
    if (found !== null) return null;
    found = launch;
  }
  return found;
}

export function datePress(presses: readonly number[], launch: number, maxLag: number): number {
  let lag = -1;
  for (const p of presses) {
    if (p > launch - 1 || p < launch - 1 - maxLag) continue;
    if (lag >= 0) return -1;
    lag = launch - 1 - p;
  }
  return lag;
}
