import { createHash } from "node:crypto";
import type { Collision } from "../core/collision.ts";
import { TUNING } from "../core/tuning.ts";
import { emptyInput } from "../core/types.ts";
import type { PlayerInput } from "../core/types.ts";
import { FLAT_POS_X, FLAT_POS_Y, FLAT_STRIDE, FLAT_VEL_X, FLAT_VEL_Y, SimWorld } from "../core/world.ts";
import { cellKinds, courseOf, cutSections, sectionGoal } from "./goresCourse.ts";
import type { Course, Section } from "./goresCourse.ts";
import { replayProgram, startState } from "./pathfind.ts";
import type { PathGoal, PathSearchOpts } from "./pathfind.ts";
import { gridHash } from "./routeChoice.ts";

export const PHYSICS_VERSION = 5;

export const SOLUTION_VERSION = 1;

export type SolvedSection = {

  idx: number;

  from: number;
  to: number;
  startState: Float64Array;

  codes: number[];
  edgeTicks: number[];
  inputs: PlayerInput[];
  endState: Float64Array;
  ticks: number;

  ahead: number;

  copiesHeld: number;
};

export type MapSolution = {

  version: number;

  physicsVersion: number;

  key: string;
  cutEvery: number;
  sections: SolvedSection[];

  solvedPrefix: number;
  total: number;

  complete: boolean;

  bestTicks: number;
  attempts: number;
};

export type CourseSource = {
  course: Course;
  kinds: Uint8Array;

  cut(every: number, fromPathIndex?: number): Section[];
  goal(sec: Section): PathGoal;

  search: Partial<PathSearchOpts>;

  spawn: Float64Array;
};

export type SolverOpts = {

  cutEvery: number[];
  search: Partial<PathSearchOpts>;
  lookahead: number;

  keep: number;

  retryGrowth: number;
  maxLevels: number;

  maxBack: number;
};

export type SolverEvent =
  | { t: "progress"; done: number; total: number; section: number; level: number; note: string }

  | { t: "section"; idx: number; sec: SolvedSection }
  | { t: "done"; sol: MapSolution }
  | { t: "failed"; why: string };

export type Stitched = { inputs: PlayerInput[]; states: Float64Array; sectionAt: Int32Array; gateAt: number[] };

const sha = (h: ReturnType<typeof createHash>, label: string, layer: Uint8Array | Int16Array | undefined): void => {

  h.update(`|${label}:${layer === undefined ? "-" : layer.byteLength}|`);
  if (layer !== undefined) h.update(layer);
};

const tuningLine = (set: Readonly<Record<string, number>>): string => Object.keys(TUNING).map((name) => `${name}=${set[name]}`).join(",");

export function mapKeyOf(col: Collision, mapSha256: string | null): string {
  const snap = col.snapshot();
  const h = createHash("sha256");
  h.update(`gores-map-key|physics ${PHYSICS_VERSION}|${col.width}x${col.height}|weak ${snap.noWeakHook ? 1 : 0}|fng ${snap.fng === true ? 1 : 0}|grid ${gridHash(col)}|`);
  sha(h, "speedForce", snap.speedup?.force);
  sha(h, "speedMax", snap.speedup?.maxSpeed);
  sha(h, "speedAngle", snap.speedup?.angle);
  sha(h, "speedType", snap.speedup?.type);
  sha(h, "tuneNumber", snap.tune?.number);
  sha(h, "tuneType", snap.tune?.type);
  h.update(`|tuning ${tuningLine(TUNING)}|`);

  if (snap.zoneTuning !== undefined) {
    for (const zone of [...snap.zoneTuning.keys()].sort((a, b) => a - b)) h.update(`|zone ${zone} ${tuningLine(snap.zoneTuning.get(zone) as unknown as Record<string, number>)}|`);
  }
  h.update(`|file ${mapSha256 ?? "-"}`);
  return h.digest("hex").slice(0, 32);
}

export const JOIN_POS_PX = 0.5;
export const JOIN_VEL_PX = 0.05;

export function stateGap(a: Float64Array, b: Float64Array): { pos: number; vel: number } {
  return { pos: Math.hypot(a[FLAT_POS_X] - b[FLAT_POS_X], a[FLAT_POS_Y] - b[FLAT_POS_Y]), vel: Math.hypot(a[FLAT_VEL_X] - b[FLAT_VEL_X], a[FLAT_VEL_Y] - b[FLAT_VEL_Y]) };
}

const gapText = (g: { pos: number; vel: number }): string => `${g.pos.toFixed(3)} px and ${g.vel.toFixed(4)} px/tick`;

export const joined = (a: SolvedSection, b: SolvedSection): boolean => b.from === a.to;

export function stitch(col: Collision, sol: MapSolution): Stitched {
  const secs = sol.sections;
  const sim = new SimWorld(col, { respawnDelayTicks: 1_000_000, pickups: true });
  sim.addTee(0, { x: 0, y: 0 });
  const replays = secs.map((sec, i) => {
    const r = replayProgram(sim, sec.startState, sec.codes, sec.edgeTicks);
    if (r.ticks !== sec.ticks) throw new Error(`stitch: section ${i} (idx ${sec.idx}) replays ${r.ticks} ticks, it says ${sec.ticks}`);
    const end = r.states.subarray(r.ticks * FLAT_STRIDE, (r.ticks + 1) * FLAT_STRIDE);
    const g = stateGap(end, sec.endState);
    if (g.pos > JOIN_POS_PX || g.vel > JOIN_VEL_PX) throw new Error(`stitch: section ${i} (idx ${sec.idx}) replays to a state ${gapText(g)} from the end it stored`);
    return r;
  });
  for (let i = 0; i + 1 < secs.length; i++) {
    if (!joined(secs[i], secs[i + 1])) continue;
    const g = stateGap(secs[i].endState, secs[i + 1].startState);
    if (g.pos > JOIN_POS_PX || g.vel > JOIN_VEL_PX) throw new Error(`stitch: section ${i + 1} (idx ${secs[i + 1].idx}) starts ${gapText(g)} from where section ${i} ends`);
  }
  const total = replays.reduce((a, r) => a + r.ticks, 0);
  const inputs: PlayerInput[] = [];
  const states = new Float64Array(secs.length === 0 ? 0 : (total + 1) * FLAT_STRIDE);
  const sectionAt = new Int32Array(total);
  const gateAt: number[] = [];
  let at = 0;
  for (let i = 0; i < replays.length; i++) {
    const r = replays[i];

    if (i === 0) states.set(r.states.subarray(0, FLAT_STRIDE), 0);
    states.set(r.states.subarray(FLAT_STRIDE), (at + 1) * FLAT_STRIDE);
    for (const inp of r.inputs) inputs.push(inp);
    sectionAt.fill(i, at, at + r.ticks);
    at += r.ticks;
    gateAt.push(at);
  }
  return { inputs, states, sectionAt, gateAt };
}

export const SPAWN_SETTLE_TICKS = 300;
export function spawnRest(col: Collision, pos: { x: number; y: number }): Float64Array {
  const sim = new SimWorld(col, { respawnDelayTicks: 1_000_000, pickups: true });
  sim.addTee(0, pos);
  const idle = emptyInput();
  const st = new Float64Array(FLAT_STRIDE);
  let still = 0;
  for (let t = 0; t < SPAWN_SETTLE_TICKS; t++) {
    sim.saveFlat(0, st, 0);
    const x = st[FLAT_POS_X];
    const y = st[FLAT_POS_Y];
    sim.setInput(0, idle);
    sim.step();
    if (!sim.isAlive(0)) break;
    sim.saveFlat(0, st, 0);
    still = st[FLAT_POS_X] === x && st[FLAT_POS_Y] === y && st[FLAT_VEL_X] === 0 && st[FLAT_VEL_Y] === 0 ? still + 1 : 0;
    if (still >= 2 && sim.freezeTicksOf(0) <= 0) return st;
  }
  return startState(col, pos, 0);
}

const SPAWN_CUT_TILES = 24;

function cutFrom(course: Course, every: number, fromPathIndex: number): Section[] {
  const out: Section[] = [];
  let clamped = false;
  for (const sec of cutSections(course, every, 2 * every)) {
    if (sec.to <= fromPathIndex) continue;
    if (sec.from < fromPathIndex) {
      out.push({ ...sec, from: fromPathIndex, tiles: course.along[sec.to] - course.along[fromPathIndex] });
      clamped = true;
    } else out.push({ ...sec });
  }
  if (clamped && out.length > 1 && out[0].tiles < every / 2 && out[1].from === out[0].to) {
    const [first, second] = out;
    out.splice(0, 2, { ...first, to: second.to, tiles: course.along[second.to] - course.along[first.from] });
  }
  return out.map((sec, idx) => ({ ...sec, idx }));
}

const GOALS_KEPT = 8;
export function goresSource(col: Collision): CourseSource | null {
  const course = courseOf(col);
  if (course === null) return null;
  const kinds = cellKinds(col);
  const first = cutSections(course, SPAWN_CUT_TILES)[0] ?? { idx: 0, label: "s0", from: 0, to: course.path.length - 1, tiles: 0 };
  const goals = new Map<number, PathGoal>();
  return {
    course,
    kinds,
    cut: (every: number, fromPathIndex = 0): Section[] => cutFrom(course, every, fromPathIndex),
    goal: (sec: Section): PathGoal => {

      let g = goals.get(sec.to);
      if (g === undefined) {
        g = sectionGoal(col, course, sec, kinds);
        if (goals.size >= GOALS_KEPT) goals.delete(goals.keys().next().value as number);
        goals.set(sec.to, g);
      }
      return g;
    },
    search: { gores: true },
    spawn: spawnRest(col, { x: (course.path[first.from] % col.width) * 32 + 16, y: Math.floor(course.path[first.from] / col.width) * 32 + 16 }),
  };
}
