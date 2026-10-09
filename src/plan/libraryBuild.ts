import type { Collision } from "../core/collision.ts";
import { FLAT_STRIDE, FLAT_VEL_X, SimWorld } from "../core/world.ts";
import { emptyInput } from "../core/types.ts";
import type { PlayerInput } from "../core/types.ts";
import { Navigator, tileGoal } from "../bot/navigate.ts";
import { PathWalker } from "./pathfind.ts";
import { sideDef, wbSides } from "../bot/wayblock.ts";
import type { WbDef } from "../bot/wayblock.ts";
import type { Crossing } from "../bot/crossing.ts";
import { spawnTiles } from "./route.ts";
import { LIBRARY_VERSION, autoJobId, importLibrary, libraryFor, ownLibraryFile, shippedLibraryFile, shippedLibraryHas } from "./segmentLibrary.ts";
import type { AutoArm, AutoVerdict, LibraryFile } from "./segmentLibrary.ts";

export const centre = (t: number): number => t * 32 + 16;

export const BUILD_BOUND = { sliceWork: 1e12, planWork: 1e12, sliceMs: 1e12, planMs: 1e12, rollAhead: false, coast: "last" as const };
export const LIVE_BOUND = { sliceMs: 1e12, planMs: 1e12, planWork: 1e9 };

export function walk(col: Collision, name: string, crossings: readonly Crossing[], spawn: { tx: number; ty: number }, spot: { tx: number; ty: number }, lag: number, jitter: number, seed: number, live: boolean, scripted: boolean, seg: object, search: object, kick = 0, rec?: { states: number[]; inputs: PlayerInput[]; killed: boolean }, gate?: () => void, memoRoutes = false): { arrive: number; ticks: number; kills: number; freezes: number } {
  let rs = seed * 7919 + 17;
  const rnd = (): number => (rs = (rs * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const nav = new Navigator(col, [tileGoal(col, spot.tx, spot.ty)], {
    crossings,
    pathfind: !scripted,
    mapName: name,
    memoRoutes,
    gate,

    walker: { segment: { ...(live ? LIVE_BOUND : BUILD_BOUND), ...seg }, search, clock: gate === undefined ? undefined : () => (gate(), performance.now()), trace: process.env.NOTES ? (m: string) => console.log(`   [walker] ${m}`) : undefined },
  });
  const w = new SimWorld(col, { respawnDelayTicks: 0 });
  const put = (): void => {
    for (const t of w.allTees()) w.removeTee(t.id);
    w.addTee(0, { x: centre(spawn.tx), y: centre(spawn.ty) });
  };
  put();
  const buf = new Float64Array(FLAT_STRIDE);
  const queue: { at: number; input: PlayerInput }[] = [];
  let held = emptyInput();
  let last = -1;
  let lying = 0;
  let wasFrozen = false;
  let kills = 0;
  let freezes = 0;
  let t = 0;

  gate?.();
  for (; t < 2400 && !nav.done; t++) {
    if (t % 2 === 0) {
      let at = t + lag + (jitter > 0 && rnd() < jitter ? 1 : 0);
      if (at < last) at = last;
      last = at;
      queue.push({ at, input: nav.step(w.getTee(0)!, t, [], lag) });
      for (const n of nav.takeNotes()) if (process.env.NOTES) console.log(`   t=${t} ${n}`);
      if (nav.takeKill()) {
        if (rec !== undefined) rec.killed = true;
        kills++;
        put();
        nav.respawned();
      }
      gate?.();
    }
    while (queue.length > 0 && queue[0].at <= t) held = (queue.shift() as { input: PlayerInput }).input;
    w.setInput(0, held);
    if (rec !== undefined) {
      w.saveFlat(0, buf, 0);
      for (let q = 0; q < FLAT_STRIDE; q++) rec.states.push(buf[q]);
      rec.inputs.push({ ...held });
    }
    if (kick > 0 && rnd() < kick) {
      w.saveFlat(0, buf, 0);
      buf[FLAT_VEL_X] += (rnd() * 4 - 2);
      w.loadFlat(0, buf, 0);
    }
    w.step();
    const me = w.getTee(0)!;
    if (process.env.NOTES && me.frozen !== wasFrozen) console.log(`   t=${t} ${me.frozen ? "FROZEN" : "thawed"} at (${(me.pos.x / 32).toFixed(1)},${(me.pos.y / 32).toFixed(1)})`);
    if (me.frozen && !wasFrozen) freezes++;
    wasFrozen = me.frozen;
    lying = me.frozen && Math.hypot(me.vel.x, me.vel.y) < 0.3 ? lying + 1 : 0;
    if (lying > 200) {
      lying = 0;
      if (rec !== undefined) rec.killed = true;
      kills++;
      put();
      nav.respawned();
    }
  }
  return { arrive: nav.phase === "arrived" ? t : -1, ticks: t, kills, freezes };
}

type Tile = { tx: number; ty: number };

export type BuildJob = { id: string; spawn: Tile; spot: Tile };

export function buildJobs(mapName: string, col: Collision, def: WbDef): BuildJob[] {
  const spawns = spawnTiles(col).map((s) => ({ tx: Math.trunc(s.x / 32), ty: Math.trunc(s.y / 32) }));
  const out: BuildJob[] = [];
  for (const side of wbSides(def)) {
    const spot = sideDef(def, side).spots[0];
    if (spot === undefined || shippedLibraryHas(mapName, col, spot)) continue;
    for (const spawn of spawns) out.push({ id: autoJobId(spawn, spot), spawn, spot: { tx: spot.tx, ty: spot.ty } });
  }
  return out;
}

export type AutoSpec = { lags: readonly number[]; seeds: number; jitter: number; seedBase: number; checkSeeds: number; checkBase: number; swingLags: readonly number[]; swingSeeds: number; swingBase: number };
export const AUTO_SPEC: AutoSpec = { lags: [2, 3], seeds: 4, jitter: 0.3, seedBase: 100, checkSeeds: 8, checkBase: 1000, swingLags: [1, 2, 3, 4], swingSeeds: 4, swingBase: 1100 };
export const specId = (s: AutoSpec): string => `v1;lags ${s.lags.join(",")};seeds ${s.seeds};jitter ${s.jitter};base ${s.seedBase};check ${s.checkSeeds};${s.checkBase};swing ${s.swingLags.join(",")};${s.swingSeeds};${s.swingBase}`;

const SWING_COST = 0.2;

export function buildCost(jobs: readonly BuildJob[], spec: AutoSpec, built: ReadonlySet<string>, checked: ReadonlySet<string>): { build: number; check: number } {
  let build = 0;
  let check = 0;
  for (const j of jobs) {
    if (!built.has(j.id)) build += spec.lags.length * (spec.seeds + 1) + spec.swingLags.length * (spec.swingSeeds + 1) * SWING_COST;
    if (!checked.has(j.id)) check += spec.lags.length * (spec.checkSeeds + 1) * (1 + SWING_COST);
  }
  return { build, check };
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return -1;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export function judge(walker: AutoArm, swing: AutoArm): { use: boolean; why: string } {
  if (walker.arrived === 0) return { use: false, why: "the walker never arrived" };
  if (walker.arrived < swing.arrived) return { use: false, why: `arrived ${walker.arrived}/${walker.walks} against the swing's ${swing.arrived}` };
  if (walker.kills > swing.kills) return { use: false, why: `${walker.kills} kills against the swing's ${swing.kills}` };
  if (walker.freezes > swing.freezes) return { use: false, why: `${walker.freezes} freezes against the swing's ${swing.freezes}` };
  if (swing.median > 0 && walker.median > swing.median) return { use: false, why: `median ${walker.median} ticks against the swing's ${swing.median}` };
  if (walker.mean !== undefined && swing.mean !== undefined && swing.mean > 0 && walker.mean > swing.mean) return { use: false, why: `mean ${walker.mean} ticks against the swing's ${swing.mean}` };
  return { use: true, why: `median ${walker.median} ticks against the swing's ${swing.median}` };
}

export const SCREEN_TICKS = 25;
export function screen(walker: readonly { arrive: number }[], swing: readonly { arrive: number }[], ticks = SCREEN_TICKS): string | null {
  let slower = 0;
  let worst = 0;
  const n = Math.min(walker.length, swing.length);
  for (let i = 0; i < n; i++) {
    if (swing[i].arrive > 0 && walker[i].arrive <= 0) return "the walker did not arrive where the swing did";
    const gap = swing[i].arrive > 0 ? walker[i].arrive - swing[i].arrive : 0;
    if (gap > ticks) slower++;
    worst = Math.max(worst, gap);
  }
  return n > 0 && slower === n ? `${worst} ticks slower than the swing with no jitter` : null;
}

export type AutoHooks = {

  gate: () => void;

  stop: () => boolean;

  progress: (done: number, total: number, phase: "building" | "checking") => void;

  delta: (job: BuildJob, add: LibraryFile) => void;
  built: (job: BuildJob) => void;
  checked: (job: BuildJob, verdict: AutoVerdict) => void;

  skipped: (job: BuildJob) => void;
};

class Stopped extends Error {}
class OverBudget extends Error {}

export const JOB_BUDGET_MS = 120_000;

function threadCpuMs(): (() => number) | null {
  if (typeof process.threadCpuUsage !== "function") return null;
  return () => {
    const u = process.threadCpuUsage();
    return (u.user + u.system) / 1000;
  };
}

export function libraryDelta(sent: Map<string, number>): LibraryFile {
  const out: LibraryFile = { version: LIBRARY_VERSION, maps: {} };
  const all = ownLibraryFile();
  for (const [key, m] of Object.entries(all.maps)) {
    for (const [goal, tiles] of Object.entries(m.goals)) {
      for (const [tile, entries] of Object.entries(tiles)) {
        const id = `${key}#${goal}#${tile}`;
        const had = sent.get(id) ?? 0;
        if (entries.length <= had) continue;
        sent.set(id, entries.length);
        const into = (out.maps[key] ??= { name: m.name, goals: {} });
        (into.goals[goal] ??= {})[tile] = entries.slice(had);
      }
    }
  }
  return out;
}

const emptyDelta = (d: LibraryFile): boolean => Object.keys(d.maps).length === 0;

function armOf(walks: { arrive: number; kills: number; freezes: number }[]): AutoArm {
  const ticks = walks.filter((w) => w.arrive > 0).map((w) => w.arrive);
  return { walks: walks.length, arrived: ticks.length, kills: walks.reduce((a, w) => a + w.kills, 0), freezes: walks.reduce((a, w) => a + w.freezes, 0), median: median(ticks), mean: ticks.length === 0 ? -1 : Math.round((10 * ticks.reduce((a, t) => a + t, 0)) / ticks.length) / 10 };
}

export function runAutoBuild(mapName: string, col: Collision, crossings: readonly Crossing[], jobs: readonly BuildJob[], spec: AutoSpec, built: ReadonlySet<string>, checked: ReadonlySet<string>, have: LibraryFile | null, hooks: AutoHooks, budgetMs = JOB_BUDGET_MS, screenTicks = SCREEN_TICKS): void {
  const sent = new Map<string, number>();
  const cost = buildCost(jobs, spec, built, checked);
  const total = cost.build + cost.check;
  let done = 0;

  const cpu = threadCpuMs();
  let slept = 0;
  const work = (): number => (cpu !== null ? cpu() : performance.now() - slept);
  let phaseStart = work();
  const startPhase = (): void => {
    phaseStart = work();
  };

  const pause = (): void => {
    if (hooks.stop()) throw new Stopped();
    const t = performance.now();
    hooks.gate();
    slept += performance.now() - t;
  };
  const gate = (): void => {
    pause();
    if (work() - phaseStart > budgetMs) throw new OverBudget();
  };

  pause();
  shippedLibraryFile();
  pause();
  if (have !== null) {
    importLibrary(have);
    pause();
  }
  libraryDelta(sent);

  const run = (job: BuildJob, lag: number, jitter: number, seed: number, scripted: boolean, live = false) => walk(col, mapName, crossings, job.spawn, job.spot, lag, jitter, seed, live, scripted, {}, {}, 0, undefined, gate, true);

  const skipped = new Set<string>();
  for (const job of jobs) {
    if (built.has(job.id)) continue;
    hooks.progress(done, total, "building");
    startPhase();
    const lib = libraryFor(mapName, col, job.spot);
    try {

      for (const lag of spec.swingLags) {
        for (let k = 0; k <= spec.swingSeeds; k++) {
          const rec = { states: [] as number[], inputs: [] as PlayerInput[], killed: false };
          const r = walk(col, mapName, crossings, job.spawn, job.spot, lag, k === 0 ? 0 : spec.jitter, spec.swingBase + k, false, true, {}, {}, 0, rec, gate, true);
          if (r.arrive > 0 && !rec.killed && lib !== null) {
            const box = { x0: job.spot.tx - 1, y0: job.spot.ty - 1, x1: job.spot.tx + 1, y1: job.spot.ty + 1 };
            new PathWalker(col, { zone: [box], spots: [job.spot], stop: false }, job.spawn, { library: lib }).seedFrom(Float64Array.from(rec.states), rec.inputs);
          }
          done += SWING_COST;
          hooks.progress(done, total, "building");
        }
      }
      for (const lag of spec.lags) {
        for (let k = 0; k <= spec.seeds; k++) {
          run(job, lag, k === 0 ? 0 : spec.jitter, spec.seedBase + k, false);
          done++;
          hooks.progress(done, total, "building");
        }
      }
    } catch (e) {
      if (!(e instanceof OverBudget)) throw e;
      skipped.add(job.id);
    }

    const d = libraryDelta(sent);
    if (!emptyDelta(d)) hooks.delta(job, d);
    if (skipped.has(job.id)) hooks.skipped(job);
    else hooks.built(job);
  }
  for (const job of jobs) {
    if (checked.has(job.id) || skipped.has(job.id)) continue;
    hooks.progress(done, total, "checking");
    startPhase();
    const walker: { arrive: number; kills: number; freezes: number }[] = [];
    const swing: { arrive: number; kills: number; freezes: number }[] = [];
    let lost: string | null = null;
    try {

      const order: { lag: number; k: number }[] = [];
      for (let k = 0; k <= spec.checkSeeds; k++) for (const lag of spec.lags) order.push({ lag, k });
      for (const { lag, k } of order) {
        if (k === 1 && lost === null) lost = screen(walker, swing, screenTicks);
        if (lost !== null) {
          done += (1 + SWING_COST) * (spec.checkSeeds + 1 - k) * spec.lags.length;
          break;
        }
        const jitter = k === 0 ? 0 : spec.jitter;
        walker.push(run(job, lag, jitter, spec.checkBase + k, false, true));
        swing.push(run(job, lag, jitter, spec.checkBase + k, true));
        done += 1 + SWING_COST;
        hooks.progress(done, total, "checking");
      }
    } catch (e) {
      if (!(e instanceof OverBudget)) throw e;
      skipped.add(job.id);
    }

    const d = libraryDelta(sent);
    if (!emptyDelta(d)) hooks.delta(job, d);
    if (skipped.has(job.id)) {
      hooks.skipped(job);
      continue;
    }
    const w = armOf(walker);
    const s = armOf(swing);
    hooks.checked(job, lost !== null ? { use: false, why: lost, walker: w, swing: s } : { ...judge(w, s), walker: w, swing: s });
  }
  hooks.progress(total, total, "checking");
}

export const isStopped = (e: unknown): boolean => e instanceof Stopped;
