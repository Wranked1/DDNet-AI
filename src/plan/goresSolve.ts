import type { Collision } from "../core/collision.ts";
import { FLAT_FREEZE_LEFT, FLAT_POS_X, FLAT_POS_Y, FLAT_STRIDE, FLAT_VEL_X } from "../core/world.ts";
import { MACRO_ROOT, PathSearcher, goalReached, particleStarts } from "./pathfind.ts";
import type { PathGoal, PathSearchOpts, Route } from "./pathfind.ts";
import { sectionGoal } from "./goresCourse.ts";
import type { Course, Section } from "./goresCourse.ts";

const TILE = 32;

export const COPY_NUDGE_PX = 2;

export type SolveOpts = { search: Partial<PathSearchOpts>; lookahead: number };

export type Solved = {

  route: Route | null;

  goal: PathGoal;

  ahead: number;

  sim: number;
  expanded: number;
  ms: number;

  searcher: PathSearcher | null;
};

export function cutRoute(route: Route, t: number): Route {
  const codes: number[] = [];
  const edgeTicks: number[] = [];
  let at = 0;
  for (let e = 0; e < route.codes.length && at < t; e++) {
    codes.push(route.codes[e]);
    edgeTicks.push(Math.min(route.edgeTicks[e], t - at));
    at += route.edgeTicks[e];
  }
  let freezes = 0;
  for (let i = 1; i <= t; i++) if (route.states[i * FLAT_STRIDE + FLAT_FREEZE_LEFT] > 0 && route.states[(i - 1) * FLAT_STRIDE + FLAT_FREEZE_LEFT] <= 0) freezes++;
  return { ...route, ticks: t, codes, edgeTicks, inputs: route.inputs.slice(0, t), states: route.states.slice(0, (t + 1) * FLAT_STRIDE), freezes };
}

export function firstCrossing(col: Collision, goal: PathGoal, route: Route): number {
  const st = route.states;
  for (let t = 1; t <= route.ticks; t++) {
    const o = t * FLAT_STRIDE;
    if (goalReached(col, goal, st[o + FLAT_POS_X], st[o + FLAT_POS_Y], st[o + FLAT_VEL_X], st[o + FLAT_FREEZE_LEFT] > 0)) return t;
  }
  return -1;
}

export function solveSection(col: Collision, course: Course, sections: readonly Section[], k: number, start: Float64Array, kinds: Uint8Array, o: SolveOpts): Solved {
  const sec = sections[k];
  const own = sectionGoal(col, course, sec, kinds);
  const tx = Math.floor(start[FLAT_POS_X] / TILE);
  const ty = Math.floor(start[FLAT_POS_Y] / TILE);
  const P = o.search.particles ?? 1;
  const starts = P > 1 ? particleStarts(col, start, P, COPY_NUDGE_PX) : start;

  let reach = 0;
  while (reach < o.lookahead && k + reach + 1 < sections.length && sections[k + reach + 1].from === sections[k + reach].to) reach++;
  const out: Solved = { route: null, goal: own, ahead: -1, sim: 0, expanded: 0, ms: 0, searcher: null };
  const t0 = performance.now();
  for (let a = reach; a >= 0; a--) {
    const goal = a === 0 ? own : sectionGoal(col, course, sections[k + a], kinds);
    const searcher = new PathSearcher(col, goal, o.search, { tx, ty });
    const route = searcher.search(starts, MACRO_ROOT);
    out.sim += searcher.simTicks;
    if (route === null) continue;
    const cut = a === 0 ? route.ticks : firstCrossing(col, own, route);
    if (cut < 0) continue;
    out.route = a === 0 ? route : cutRoute(route, cut);
    out.ahead = a;
    out.expanded = route.expanded;
    out.searcher = searcher;
    break;
  }
  out.ms = performance.now() - t0;
  return out;
}
