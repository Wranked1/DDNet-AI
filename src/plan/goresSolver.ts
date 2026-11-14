import { float32 } from "../core/float.ts";
import { HOOK_FLYING, HOOK_GRABBED } from "../core/characterCore.ts";
import type { Collision } from "../core/collision.ts";
import { FLAT_ALIVE, FLAT_FREEZE_LEFT, FLAT_HOOK_STATE, FLAT_HOOK_X, FLAT_HOOK_Y, FLAT_JUMPED, FLAT_POS_X, FLAT_POS_Y, FLAT_STRIDE, FLAT_VEL_X, FLAT_VEL_Y, SimWorld } from "../core/world.ts";
import type { Section } from "./goresCourse.ts";
import { FREEZE_OK_TICKS, FREEZE_WAIT_OK_TICKS, GRACE_TICKS, JITTER_COPIES, jitterHolds, judgeStates } from "./goresJudge.ts";
import { JOIN_POS_PX, JOIN_VEL_PX, PHYSICS_VERSION, SOLUTION_VERSION, joined, stateGap, stitch } from "./goresMap.ts";
import type { CourseSource, MapSolution, SolvedSection, SolverEvent, SolverOpts } from "./goresMap.ts";
import type { Solved } from "./goresSolve.ts";
import { solveSectionGen } from "./goresSolveGen.ts";
import type { SolveGenOpts, SolveMany } from "./goresSolveGen.ts";
import { DEFAULT_SEARCH, MACRO_TICKS, MACRO_WAIT, replayProgram } from "./pathfind.ts";
import type { PathSearchOpts } from "./pathfind.ts";

export const DEFAULT_SOLVER_OPTS: SolverOpts = { cutEvery: [24, 16, 32, 12], search: {}, lookahead: 1, keep: 4, retryGrowth: 4, maxLevels: 4, maxBack: 6, fieldV: DEFAULT_SEARCH.v };

export { POLISH_PASSES } from "./goresMap.ts";

export const DRILL_SEARCH: Partial<PathSearchOpts> = { maxExpansions: 40_000, improveExpansions: 4_000, maxNodes: DEFAULT_SEARCH.maxNodes, timeLimitMs: Number.POSITIVE_INFINITY };

export const MAX_NODES = 1_200_000;

export const STALL_FACTOR = 2;

export const ATTEMPTS_PER_SECTION = 40;

export const STALL_SIM_TICKS = 150_000_000;

export const FIELDV_LEVELS = 2;

export const CHEAP_LEVELS = 2;

const GREEDY: Partial<PathSearchOpts> = { w: 1.5 };
const PROGRESS: Partial<PathSearchOpts> = { w: 2, anchorOrder: "progress" };
const JUMPING: Partial<PathSearchOpts> = { w: 1.5, anchorOrder: "progress", throwJump: true };
const MORE_THROWS: Partial<PathSearchOpts> = { ...JUMPING, maxAnchors: 9 };
export const PERSONALITIES: readonly { search: Partial<PathSearchOpts>; lookahead?: number }[] = [
  { search: GREEDY },
  { search: PROGRESS },
  { search: JUMPING },
  { search: MORE_THROWS },
  { search: MORE_THROWS, lookahead: 2 },
  { search: MORE_THROWS, lookahead: 0 },
];

export type SectionSolver = (col: Collision, source: CourseSource, sections: readonly Section[], k: number, start: Float64Array, o: SolveGenOpts) => Generator<number, SolveMany, void>;
export type MapSolverOpts = Partial<SolverOpts> & { solveFn?: SectionSolver };

type Frame = {
  start: Float64Array;
  startKey: string;
  level: number;
  cands: SolvedSection[] | null;
  next: number;

  quick: boolean;
  chosen: SolvedSection | null;
};

type SegmentEnd = { kind: "finished" } | { kind: "healed" } | { kind: "exhausted"; deepest: number };

export function stateKeyOf(st: Float64Array): string {
  const hs = st[FLAT_HOOK_STATE];
  const rope = hs === HOOK_GRABBED ? 2 : hs === HOOK_FLYING ? 1 : 0;
  const anchor = rope === 2 ? `${st[FLAT_HOOK_X] >> 5}:${st[FLAT_HOOK_Y] >> 5}` : "";
  const left = st[FLAT_FREEZE_LEFT];
  const freeze = left > 0 ? Math.min(7, 1 + (left >> 5)) : 0;
  return [Math.floor(st[FLAT_POS_X] / 8), Math.floor(st[FLAT_POS_Y] / 8), Math.round(st[FLAT_VEL_X]), Math.round(st[FLAT_VEL_Y] / 1.5), rope, anchor, st[FLAT_JUMPED] & 3, freeze].join(",");
}

const deadId = (every: number, sec: Section, key: string): string => `${every}|${sec.from}-${sec.to}|${key}`;

const reachOf = (path: readonly SolvedSection[]): number => (path.length === 0 ? -1 : path[path.length - 1].to);

export class MapSolver {
  private readonly col: Collision;
  private readonly source: CourseSource;
  private readonly opts: SolverOpts;
  private readonly solveFn: SectionSolver;
  private readonly baseSearch: Partial<PathSearchOpts>;
  private readonly resume: MapSolution | null;
  private readonly gate: () => void;
  private readonly events: SolverEvent[] = [];

  private settled: SolvedSection[] = [];

  private announced: SolvedSection[] = [];

  private best: SolvedSection[] = [];
  private attempts = 0;
  private totalSections = 0;
  private readonly dead = new Set<string>();

  constructor(col: Collision, source: CourseSource, opts: MapSolverOpts = {}, resume: MapSolution | null = null, gate: () => void = () => {}) {

    if (!float32) throw new Error("the gores solver needs the float physics: setFloat32(true) (core/float.ts)");
    this.col = col;
    this.source = source;
    this.gate = gate;
    this.resume = resume;
    const { solveFn, ...given } = opts;
    this.solveFn = solveFn ?? solveSectionGen;
    const defined = Object.fromEntries(Object.entries(given).filter(([, v]) => v !== undefined)) as Partial<SolverOpts>;
    this.opts = { ...DEFAULT_SOLVER_OPTS, ...defined };

    this.opts.cutEvery = this.opts.cutEvery.filter((e) => Number.isInteger(e) && e >= 4);
    if (this.opts.cutEvery.length === 0) this.opts.cutEvery = DEFAULT_SOLVER_OPTS.cutEvery;
    this.opts.keep = Math.max(1, Math.floor(this.opts.keep));
    this.opts.maxLevels = Math.max(1, Math.floor(this.opts.maxLevels));
    this.opts.maxBack = Math.max(0, Math.floor(this.opts.maxBack));
    this.baseSearch = { ...DRILL_SEARCH, ...source.search, ...this.opts.search };
  }

  takeEvents(): SolverEvent[] {
    return this.events.splice(0, this.events.length);
  }

  *run(): Generator<number, MapSolution, void> {
    const lastPath = this.source.course.path.length - 1;
    this.adoptResume();
    let cutIx = 0;

    let healTo: number | null = null;
    let failure = "";
    while (!(this.settled.length > 0 && this.settled[this.settled.length - 1].to >= lastPath)) {
      const end: SegmentEnd = yield* this.segment(cutIx, healTo);
      if (end.kind === "finished") break;
      if (this.attempts > ATTEMPTS_PER_SECTION * Math.max(1, this.totalSections)) {
        failure = `gave up after ${this.attempts} searches (course tile ${reachOf(this.best)} of ${lastPath}): kept the verified prefix`;
        break;
      }
      if (end.kind === "healed") {
        cutIx = 0;
        healTo = null;
        this.progress(this.settled.length, 0, `past the dead end, back to cuts of ${this.opts.cutEvery[0]} tiles`);
        continue;
      }
      healTo = Math.max(healTo ?? -1, end.deepest);
      if (cutIx + 1 < this.opts.cutEvery.length) {
        cutIx++;
        this.progress(this.settled.length, 0, `backing up is used up at section ${this.settled.length}: re-cutting every ${this.opts.cutEvery[cutIx]} tiles`);
        continue;
      }
      failure = `no cut passes beyond section ${this.settled.length} (course tile ${end.deepest} of ${lastPath}): kept the verified prefix`;
      break;
    }
    return this.finish(failure);
  }

  private finish(failure: string): MapSolution {
    const lastPath = this.source.course.path.length - 1;
    const path = reachOf(this.best) >= reachOf(this.settled) ? this.best : this.settled;
    const complete = path.length > 0 && path[path.length - 1].to >= lastPath;
    this.announce(path);
    const sol: MapSolution = {
      version: SOLUTION_VERSION,
      physicsVersion: PHYSICS_VERSION,
      key: "",
      cutEvery: this.opts.cutEvery[0],
      sections: path.slice(),
      solvedPrefix: path.length,
      total: Math.max(path.length, this.totalSections),
      complete,
      bestTicks: path.reduce((a, s) => a + s.ticks, 0),
      attempts: this.attempts,
    };
    if (complete) this.events.push({ t: "done", sol });
    else this.events.push({ t: "failed", why: failure === "" ? "the route stops before the finish" : failure });
    return sol;
  }

  private announce(path: readonly SolvedSection[]): void {
    let i = 0;
    while (i < this.announced.length && i < path.length && this.announced[i] === path[i]) i++;
    for (let j = i; j < path.length; j++) this.events.push({ t: "section", idx: j, sec: path[j] });
    this.announced = path.slice();
  }

  private progress(section: number, level: number, note: string): void {
    this.events.push({ t: "progress", done: this.best.length, total: Math.max(this.best.length, this.totalSections), section, level, note });
  }

  private adoptResume(): void {
    const r = this.resume;
    if (r === null || r.physicsVersion !== PHYSICS_VERSION || r.version !== SOLUTION_VERSION || r.sections.length === 0) return;
    const secs = r.sections;
    const lastPath = this.source.course.path.length - 1;
    try {
      for (let i = 0; i < secs.length; i++) {
        const s = secs[i];
        if (s.idx !== i || s.startState.length !== FLAT_STRIDE || s.endState.length !== FLAT_STRIDE || s.from > s.to || s.to > lastPath) return;
        if (i > 0 && joined(secs[i - 1], s)) {
          const g = stateGap(secs[i - 1].endState, s.startState);
          if (g.pos > JOIN_POS_PX || g.vel > JOIN_VEL_PX) return;
        }
        if (i > 0 && s.from < secs[i - 1].to) return;
      }

      const first = this.source.cut(this.opts.cutEvery[0], 0)[0];
      if (first === undefined || secs[0].from !== first.from) return;
      const g = stateGap(this.source.spawn, secs[0].startState);
      if (g.pos > JOIN_POS_PX || g.vel > JOIN_VEL_PX) return;

      stitch(this.col, r);
    } catch {
      return;
    }
    const own = secs.map((x) => ({ ...x, startState: x.startState.slice(), endState: x.endState.slice() }));
    this.settled = own.slice();
    this.best = own.slice();
    this.announced = own.slice();
    this.totalSections = Math.max(r.total, secs.length);
    this.progress(secs.length, 0, `resumed with ${secs.length} sections`);
  }

  private newFrame(start: Float64Array): Frame {
    return { start, startKey: stateKeyOf(start), level: 0, cands: null, next: 0, quick: false, chosen: null };
  }

  private *segment(cutIx: number, healTo: number | null): Generator<number, SegmentEnd, void> {
    const baseCount = this.settled.length;
    const base = baseCount === 0 ? null : this.settled[baseCount - 1];
    const basePath = base === null ? 0 : base.to;
    const baseState = base === null ? this.source.spawn : base.endState;
    const every = this.opts.cutEvery[cutIx];
    const sections = this.source.cut(every, basePath);

    let stalled = 0;
    let stalledSim = 0;
    const stallCap = STALL_FACTOR * this.opts.keep * this.opts.maxLevels * (this.opts.maxBack + 1);
    this.totalSections = baseCount + sections.length;
    if (sections.length === 0) return { kind: "exhausted", deepest: basePath };
    const frames: Frame[] = [this.newFrame(baseState)];

    let settledIn = 0;
    let deepest = 0;
    let k = 0;
    for (;;) {
      const fr = frames[k];
      if (fr.cands === null) {
        if (++stalled > stallCap || stalledSim > STALL_SIM_TICKS) return { kind: "exhausted", deepest: sections[deepest].to };
        const work = this.solveFrame(fr, sections, k, baseCount + k);
        for (;;) {
          const r = work.next();
          if (r.done === true) break;
          stalledSim += r.value;
          yield r.value;
        }
      }
      const cands = fr.cands as SolvedSection[];
      let pick: SolvedSection | null = null;
      while (fr.next < cands.length) {
        const c = cands[fr.next++];
        if (k + 1 < sections.length && this.dead.has(deadId(every, sections[k + 1], stateKeyOf(c.endState)))) continue;
        pick = c;
        break;
      }
      if (pick !== null) {
        fr.chosen = pick;
        const path = this.settled.concat(frames.slice(settledIn, k + 1).map((f) => f.chosen as SolvedSection));

        if (k + 1 === sections.length || reachOf(path) > reachOf(this.best)) this.best = path;
        this.announce(path);
        this.progress(baseCount + k, fr.level, `solved ${this.best.length} of ${Math.max(this.best.length, this.totalSections)} sections`);
        if (k + 1 === sections.length) return { kind: "finished" };
        frames.push(this.newFrame(pick.endState));
        k++;
        if (k > deepest) {
          deepest = k;
          stalled = 0;
          stalledSim = 0;
          const floor = Math.max(0, deepest - this.opts.maxBack);
          while (settledIn < floor) this.settled.push(frames[settledIn++].chosen as SolvedSection);
        }
        if (healTo !== null && this.settled.length > baseCount && this.settled[this.settled.length - 1].to > healTo) return { kind: "healed" };
        continue;
      }

      if (!fr.quick && fr.level + 1 < this.opts.maxLevels) {
        fr.level++;
        fr.cands = null;
        fr.next = 0;
        this.progress(baseCount + k, fr.level, `section ${baseCount + k}: searching again at level ${fr.level}`);
        continue;
      }
      this.dead.add(deadId(every, sections[k], fr.startKey));
      frames.pop();

      if (k > 0 && sections[k].from !== sections[k - 1].to) return { kind: "exhausted", deepest: sections[deepest].to };
      if (k - 1 < settledIn) return { kind: "exhausted", deepest: sections[deepest].to };
      k--;
      this.progress(baseCount + k, frames[k].level, `section ${baseCount + k + 1} is a dead end: backing up to section ${baseCount + k}`);
    }
  }

  private levelOptions(level: number): { search: Partial<PathSearchOpts>; lookahead: number } {
    const growth = this.opts.retryGrowth ** Math.max(0, level - CHEAP_LEVELS);
    const base = this.baseSearch;
    const nodes = base.maxNodes ?? DEFAULT_SEARCH.maxNodes;
    const search: Partial<PathSearchOpts> = {
      ...base,
      maxExpansions: Math.round((base.maxExpansions ?? DEFAULT_SEARCH.maxExpansions) * growth),
      maxNodes: Math.min(Math.max(nodes, Math.floor(MAX_NODES / Math.max(1, base.particles ?? 1))), Math.round(nodes * growth)),
    };
    let lookahead = this.opts.lookahead;
    if (level > 0) {
      const p = PERSONALITIES[Math.min(level - 1, PERSONALITIES.length - 1)];
      Object.assign(search, p.search);
      if (p.lookahead !== undefined) lookahead = p.lookahead;
    }
    return { search, lookahead };
  }

  private *solveFrame(fr: Frame, sections: readonly Section[], k: number, position: number): Generator<number, void, void> {
    const lv = this.levelOptions(fr.level);
    const freezeOk = fr.level >= 1 ? FREEZE_WAIT_OK_TICKS : FREEZE_OK_TICKS;
    this.attempts++;

    const gen = this.solveFn(this.col, this.source, sections, k, fr.start, { search: lv.search, lookahead: lv.lookahead, keep: this.opts.keep * (fr.level + 1), fieldV: fr.level < FIELDV_LEVELS ? this.opts.fieldV : DEFAULT_SEARCH.v, freezeOk });
    let result: SolveMany;
    for (;;) {
      const r = gen.next();
      if (r.done === true) {
        result = r.value;
        break;
      }
      this.gate();
      yield r.value;
    }
    const built: SolvedSection[] = [];
    let jitterTicks = 0;
    for (const c of result.cands) {
      if (c.route === null) continue;
      const sec = this.sectionOf(sections[k], position, fr.start, c, k + 1 === sections.length, freezeOk);
      if (sec === null) continue;
      built.push(sec);
      jitterTicks += JITTER_COPIES * (sec.ticks + GRACE_TICKS);
    }
    fr.cands = rank(built);
    fr.next = 0;

    fr.quick = result.quick && built.length === 0 && fr.level === 0;
    this.gate();
    yield jitterTicks;
  }

  private sectionOf(sec: Section, position: number, start: Float64Array, c: Solved, last: boolean, freezeOk: number): SolvedSection | null {
    const route = c.route as NonNullable<Solved["route"]>;

    const teleports = sec.tele === true ? 1 : 0;
    let codes = [...route.codes];
    let edgeTicks = [...route.edgeTicks];
    let inputs = route.inputs.slice(0, route.ticks);
    let end = route.states.slice(route.ticks * FLAT_STRIDE, (route.ticks + 1) * FLAT_STRIDE);

    if (inputs.length % 2 === 1 && codes.length > 0) {
      const e = codes.length - 1;
      const longer = codes[e] === MACRO_WAIT || edgeTicks[e] < MACRO_TICKS;
      const padCodes = longer ? codes : [...codes, codes[e]];
      const padTicks = longer ? [...edgeTicks.slice(0, e), edgeTicks[e] + 1] : [...edgeTicks, 1];
      const r = replayProgram(this.padSim(), start, padCodes, padTicks);
      const padEnd = r.states.slice(r.ticks * FLAT_STRIDE, (r.ticks + 1) * FLAT_STRIDE);

      const fine = r.ticks === inputs.length + 1 && padEnd[FLAT_ALIVE] === 1 && padEnd[FLAT_FREEZE_LEFT] <= 0 && judgeStates(this.col, r.states, r.ticks, teleports, freezeOk).ok;
      if (fine) {
        codes = padCodes;
        edgeTicks = padTicks;
        inputs = r.inputs.slice(0, r.ticks);
        end = padEnd;
      } else if (!last) return null;
    }
    return {
      idx: position,
      from: sec.from,
      to: sec.to,
      startState: start.slice(0, FLAT_STRIDE),
      codes,
      edgeTicks,
      inputs,
      endState: end,
      ticks: inputs.length,
      ahead: c.ahead,
      copiesHeld: jitterHolds(this.col, c.goal, start, inputs, JITTER_COPIES, teleports, freezeOk),
      ...(sec.tele === true ? { tele: true as const } : {}),
    };
  }

  private padWorld: SimWorld | null = null;
  private padSim(): SimWorld {
    if (this.padWorld === null) {
      this.padWorld = new SimWorld(this.col, { respawnDelayTicks: 1_000_000, pickups: true });
      this.padWorld.addTee(0, { x: 0, y: 0 });
    }
    return this.padWorld;
  }
}

function rank(built: readonly SolvedSection[]): SolvedSection[] {
  const order = built.map((s, i) => ({ s, i })).sort((p, q) => p.s.ticks - q.s.ticks || p.i - q.i);
  if (order.length === 0) return [];
  const limit = order[0].s.ticks * 1.05;
  const near = order.filter((x) => x.s.ticks <= limit).sort((p, q) => q.s.copiesHeld - p.s.copiesHeld || p.s.ticks - q.s.ticks || p.i - q.i);
  const rest = order.filter((x) => x.s.ticks > limit);
  return [...near, ...rest].map((x) => x.s);
}
