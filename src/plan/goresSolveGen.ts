import type { Collision } from "../core/collision.ts";
import { FLAT_POS_X, FLAT_POS_Y, FLAT_STRIDE, FLAT_VEL_X, FLAT_VEL_Y } from "../core/world.ts";
import type { Section } from "./goresCourse.ts";
import { FREEZE_OK_TICKS, judgeStates, landingsAt, teleportsIn } from "./goresJudge.ts";
import type { CourseSource } from "./goresMap.ts";
import { COPY_NUDGE_PX, cutRoute, firstCrossing } from "./goresSolve.ts";
import type { Solved } from "./goresSolve.ts";
import { DEFAULT_SEARCH, MACRO_ROOT, PathSearcher, particleStarts } from "./pathfind.ts";
import type { PathSearchOpts, Route } from "./pathfind.ts";

const TILE = 32;

export const SAME_END_PX = 4;
export const SAME_END_SPEED = 0.5;

export const QUICK_EXPANSIONS = 100;

export const POOL_FACTOR = 3;

export type SolveGenOpts = { search: Partial<PathSearchOpts>; lookahead: number; keep: number; fieldV?: number; freezeOk?: number };
export type SolveMany = { cands: Solved[]; sim: number; quick: boolean };

function* counted<T>(inner: Generator<number, T, void>, count: { yields: number }): Generator<number, T, void> {
  for (;;) {
    const r = inner.next();
    if (r.done === true) return r.value;
    count.yields++;
    yield r.value;
  }
}

function sameEnd(a: Route, b: Route): boolean {
  const oa = a.ticks * FLAT_STRIDE;
  const ob = b.ticks * FLAT_STRIDE;
  const dist = Math.hypot(a.states[oa + FLAT_POS_X] - b.states[ob + FLAT_POS_X], a.states[oa + FLAT_POS_Y] - b.states[ob + FLAT_POS_Y]);
  const speed = Math.hypot(a.states[oa + FLAT_VEL_X] - b.states[ob + FLAT_VEL_X], a.states[oa + FLAT_VEL_Y] - b.states[ob + FLAT_VEL_Y]);
  return dist < SAME_END_PX && speed < SAME_END_SPEED;
}

export function* solveSectionGen(col: Collision, source: CourseSource, sections: readonly Section[], k: number, start: Float64Array, o: SolveGenOpts): Generator<number, SolveMany, void> {
  const sec = sections[k];
  const own = source.goal(sec, o.fieldV);
  const tx = Math.floor(start[FLAT_POS_X] / TILE);
  const ty = Math.floor(start[FLAT_POS_Y] / TILE);

  const search = sec.tele === true ? { ...o.search, gores: false, pickups: true } : o.search;

  const exitTile = source.course.path[sec.to];
  const exitX = (exitTile % col.width) * TILE + TILE / 2;
  const exitY = Math.floor(exitTile / col.width) * TILE + TILE / 2;
  const P = search.particles ?? 1;
  const starts = P > 1 ? particleStarts(col, start, P, COPY_NUDGE_PX) : start;
  const keep = Math.max(1, Math.floor(o.keep));
  const pool = keep === 1 ? 1 : keep * POOL_FACTOR;
  const nodeBudget = search.maxNodes ?? DEFAULT_SEARCH.maxNodes;
  const expansionBudget = search.maxExpansions ?? DEFAULT_SEARCH.maxExpansions;

  let reach = 0;
  while (sec.tele !== true && reach < o.lookahead && k + reach + 1 < sections.length && sections[k + reach + 1].from === sections[k + reach].to && sections[k + reach + 1].tele !== true) reach++;
  const t0 = performance.now();
  let sim = 0;
  let quick = false;
  let kept: { route: Route; ahead: number; expanded: number; searcher: PathSearcher }[] = [];
  for (let a = reach; a >= 0; a--) {
    const goal = a === 0 ? own : source.goal(sections[k + a], o.fieldV);
    const searcher = new PathSearcher(col, goal, search, { tx, ty });
    const count = { yields: 0 };
    let routes: Route[];
    if (pool === 1) {
      const one = yield* counted(searcher.searchGen(starts, MACRO_ROOT), count);
      routes = one === null ? [] : [one];
    } else routes = yield* counted(searcher.searchManyGen(starts, MACRO_ROOT, nodeBudget, pool), count);
    sim += searcher.simTicks;
    const found: { route: Route; order: number; expanded: number }[] = [];
    routes.forEach((route, order) => {
      const cut = a === 0 ? route.ticks : firstCrossing(col, own, route);
      if (cut < 0) return;
      const program = a === 0 ? route : cutRoute(route, cut);
      if (!judgeStates(col, program.states, program.ticks, sec.tele === true ? 1 : 0, o.freezeOk ?? FREEZE_OK_TICKS).ok) return;

      if (sec.tele === true && (teleportsIn(program.states, program.ticks) > 1 || landingsAt(program.states, program.ticks, exitX, exitY) !== 1)) return;
      found.push({ route: program, order, expanded: route.expanded });
    });
    if (found.length === 0) {
      if (a === 0) quick = routes.length === 0 && expansionBudget >= QUICK_EXPANSIONS && count.yields * 4 + 3 < QUICK_EXPANSIONS;
      continue;
    }
    found.sort((p, q) => p.route.ticks - q.route.ticks || p.order - q.order);
    const picked: typeof found = [];
    for (const f of found) {
      if (picked.length >= keep) break;
      if (picked.some((p) => sameEnd(p.route, f.route))) continue;
      picked.push(f);
    }
    kept = picked.map((f) => ({ route: f.route, ahead: a, expanded: f.expanded, searcher }));
    break;
  }
  const ms = performance.now() - t0;
  const cands: Solved[] = kept.map((c) => ({ route: c.route, goal: own, ahead: c.ahead, sim, expanded: c.expanded, ms, searcher: c.searcher }));
  return { cands, sim, quick };
}
