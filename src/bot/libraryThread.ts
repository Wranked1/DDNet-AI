import { Worker } from "node:worker_threads";
import type { Collision, CollisionSnapshot } from "../core/collision.ts";
import { AUTO_SPEC, JOB_BUDGET_MS, buildJobs, specId } from "../plan/libraryBuild.ts";
import type { AutoSpec, BuildJob } from "../plan/libraryBuild.ts";
import { autoJobId, autoKeyOf, autoStateOf, importLibrary, libraryFor, ownLibraryFile, setAutoState } from "../plan/segmentLibrary.ts";
import type { AutoState, AutoVerdict, LibraryFile } from "../plan/segmentLibrary.ts";
import { choiceKey } from "../plan/routeChoice.ts";
import type { WbDef } from "./wayblock.ts";

export const FLAG_PAUSE = 0;
export const FLAG_STOP = 1;

export const FLAG_DUTY = 2;

export const FLAG_SLEEP = 3;

export const FLAG_BEAT = 4;
const FLAG_COUNT = 5;

export const DUTY_PERCENT = 60;

export const FIGHT_DUTY_PERCENT = 25;

const HEAP_MB = 768;

const MAX_FAILS = 2;

const MAX_JOBS = 80;

const MAX_SKIPS = 2;

export type AutoInit = {
  mapName: string;
  snapshot: CollisionSnapshot;
  spec: AutoSpec;
  jobs: BuildJob[];
  built: string[];
  checked: string[];
  have: LibraryFile | null;
  flags: SharedArrayBuffer;
};

export type FromBuilder =
  | { t: "progress"; done: number; total: number; phase: "building" | "checking" }
  | { t: "delta"; id: string; add: LibraryFile }
  | { t: "built"; id: string }
  | { t: "checked"; id: string; verdict: AutoVerdict }
  | { t: "skipped"; id: string }
  | { t: "done"; peakHeapMb: number; maxRssMb: number }
  | { t: "failed"; why: string };

export type AutoStatus = {
  state: "off" | "building" | "checking" | "done" | "failed";

  percent: number;

  walker: number;
  walks: number;
  text: string;
};

type WorkerLike = Pick<Worker, "on" | "postMessage" | "terminate">;

export type BuilderHooks = {
  log: (msg: string) => void;

  changed: () => void;

  save: (force?: boolean) => void;

  verdicts: () => void;
};

export type BuilderDeps = {
  makeWorker?: (init: AutoInit) => WorkerLike;
  spec?: AutoSpec;
  now?: () => number;
};

function realWorker(init: AutoInit): WorkerLike {

  const worker = new Worker(new URL("./libraryWorker.ts", import.meta.url), {
    workerData: init,

    env: { ...process.env, PATHFIND_VETO: "0", PATHFIND_REMEMBER: "0" },
    resourceLimits: { maxOldGenerationSizeMb: HEAP_MB, maxYoungGenerationSizeMb: 48 },
  });
  worker.unref();
  return worker;
}

export class LibraryBuilder {
  private readonly hooks: BuilderHooks;
  private readonly makeWorker: (init: AutoInit) => WorkerLike;
  private readonly spec: AutoSpec;
  private readonly now: () => number;
  private worker: WorkerLike | null = null;
  private flags: Int32Array | null = null;

  private key: string | null = null;
  private mapName = "";
  private col: Collision | null = null;

  private jobs: BuildJob[] = [];
  private pending: BuildJob[] = [];
  private startedAt = 0;
  private cur: AutoStatus = { state: "off", percent: 0, walker: 0, walks: 0, text: "" };
  private paused = false;

  private readonly skips = new Map<string, number>();
  private runSkipped = 0;

  peak: { heapMb: number; rssMb: number } | null = null;

  constructor(hooks: BuilderHooks, deps: BuilderDeps = {}) {
    this.hooks = hooks;
    this.makeWorker = deps.makeWorker ?? realWorker;
    this.spec = deps.spec ?? AUTO_SPEC;
    this.now = deps.now ?? Date.now;
  }

  status(): AutoStatus {
    return this.cur;
  }

  get running(): boolean {
    return this.worker !== null;
  }

  private set(s: Partial<AutoStatus>): void {
    this.cur = { ...this.cur, ...s };
    this.hooks.changed();
  }

  start(mapName: string, col: Collision, def: WbDef | null): void {
    const key = choiceKey(mapName, col);
    if (this.key === key && (this.worker !== null || this.cur.state === "done" || this.cur.state === "failed")) return;
    this.cancel();
    this.key = key;
    this.mapName = mapName;
    this.col = col;
    const jobs = def === null ? [] : buildJobs(mapName, col, def);
    if (jobs.length === 0) {
      this.set({ state: "off", percent: 0, walker: 0, walks: 0, text: "" });
      return;
    }
    this.launch(jobs);
  }

  private record(): AutoState {
    const spec = specId(this.spec);
    const col = this.col as Collision;
    const had = autoStateOf(this.mapName, col);
    if (had !== undefined && had.spec === spec) {
      if (autoKeyOf(this.mapName, col) === choiceKey(this.mapName, col)) return had;

      const own: AutoState = { ...had, jobs: { ...had.jobs } };
      setAutoState(this.mapName, col, own);
      return own;
    }
    const st: AutoState = { name: this.mapName.trim().toLowerCase(), spec, jobs: {} };
    setAutoState(this.mapName, col, st);
    return st;
  }

  ask(from: { tx: number; ty: number }, goal: { tx: number; ty: number }): void {
    const col = this.col;
    if (col === null) return;
    const id = autoJobId(from, goal);
    const st = this.record();
    const had = st.jobs[id];

    if (had?.verdict !== undefined || this.gaveUp(id) || this.pending.some((j) => j.id === id) || (this.worker !== null && this.jobs.some((j) => j.id === id)) || (st.fails ?? 0) >= MAX_FAILS) return;

    const running = this.worker === null ? 0 : this.jobs.filter((j) => st.jobs[j.id] === undefined).length;
    if (had === undefined && Object.keys(st.jobs).length + running + this.pending.length >= MAX_JOBS) return;
    this.pending.push({ id, spawn: { ...from }, spot: { ...goal } });
    if (this.worker === null) this.launch(this.pending.splice(0));
  }

  private gaveUp(id: string): boolean {
    return (this.skips.get(`${this.key}#${id}`) ?? 0) >= MAX_SKIPS;
  }

  private launch(all: BuildJob[]): void {
    const mapName = this.mapName;
    const col = this.col as Collision;
    const key = choiceKey(mapName, col);
    const jobs = all.filter((j) => !this.gaveUp(j.id));
    this.jobs = jobs;
    this.runSkipped = 0;
    const st = this.record();
    const built = jobs.filter((j) => st.jobs[j.id]?.built === true).map((j) => j.id);
    const checked = jobs.filter((j) => st.jobs[j.id]?.verdict !== undefined).map((j) => j.id);
    if (checked.length === jobs.length) {
      this.finish(st, false);
      return;
    }
    if ((st.fails ?? 0) >= MAX_FAILS) {
      this.set({ state: "failed", percent: 0, text: `paths: not built (${st.failed ?? "failed"}); the swing stays` });
      return;
    }
    const buffer = new SharedArrayBuffer(FLAG_COUNT * 4);
    const flags = new Int32Array(buffer);
    flags[FLAG_PAUSE] = this.paused ? 1 : 0;
    flags[FLAG_DUTY] = this.duty;
    this.flags = flags;

    for (const j of jobs) libraryFor(mapName, col, j.spot);
    const mine = ownLibraryFile(key, new Set(jobs.map((j) => `${j.spot.tx},${j.spot.ty}`)));
    const have: LibraryFile | null = mine.maps[key] === undefined ? null : mine;
    const init: AutoInit = { mapName, snapshot: col.snapshot(), spec: this.spec, jobs, built, checked, have, flags: buffer };
    this.startedAt = this.now();
    this.peak = null;
    this.set({ state: built.length === jobs.length ? "checking" : "building", percent: 0, text: built.length === jobs.length ? "checking paths: 0%" : "building paths: 0%" });
    let worker: WorkerLike;
    try {
      worker = this.makeWorker(init);
    } catch (err) {
      this.fail(st, err instanceof Error ? err.message : String(err));
      return;
    }
    this.worker = worker;
    worker.on("message", (m: FromBuilder) => {
      if (this.worker !== worker) return;

      try {
        this.onMessage(m, st);
      } catch (err) {
        if (this.worker === worker) this.worker = null;
        void worker.terminate();
        try {
          this.fail(st, err instanceof Error ? err.message : String(err));
        } catch {

        }
      }
    });
    worker.on("error", (err) => {
      if (this.worker !== worker) return;
      this.worker = null;
      this.fail(st, err instanceof Error ? err.message : String(err));
    });
    worker.on("exit", (code) => {
      if (this.worker !== worker) return;
      this.worker = null;
      this.fail(st, `the thread ended (code ${code})`);
    });
  }

  private onMessage(m: FromBuilder, st: AutoState): void {
    switch (m.t) {
      case "progress": {
        const percent = m.total <= 0 ? 100 : Math.min(99, Math.floor((100 * m.done) / m.total));
        this.set({ state: m.phase, percent, text: `${m.phase === "building" ? "building" : "checking"} paths: ${percent}%` });
        return;
      }
      case "delta":
        importLibrary(m.add);
        return;
      case "built":
        st.jobs[m.id] = { ...st.jobs[m.id], built: true };
        setAutoState(this.mapName, this.col as Collision, st);
        this.hooks.save();
        return;
      case "checked":
        st.jobs[m.id] = { ...st.jobs[m.id], built: true, verdict: m.verdict };
        setAutoState(this.mapName, this.col as Collision, st);
        this.hooks.save();
        this.hooks.verdicts();
        return;
      case "skipped": {

        const k = `${this.key}#${m.id}`;
        this.skips.set(k, (this.skips.get(k) ?? 0) + 1);
        this.runSkipped++;
        return;
      }
      case "done": {
        const w = this.worker;
        this.worker = null;
        void w?.terminate();
        this.peak = { heapMb: m.peakHeapMb, rssMb: m.maxRssMb };
        this.finish(st, true);
        return;
      }
      case "failed": {
        const w = this.worker;
        this.worker = null;
        void w?.terminate();
        this.fail(st, m.why);
        return;
      }
    }
  }

  private counts(st: AutoState): { walker: number; walks: number } {
    let walker = 0;
    let walks = 0;
    for (const j of Object.values(st.jobs)) {
      if (j.verdict === undefined) continue;
      walks++;
      if (j.verdict.use) walker++;
    }
    return { walker, walks };
  }

  private finish(st: AutoState, fresh: boolean): void {

    if (fresh || st.failed !== undefined || st.fails !== undefined) {
      delete st.failed;
      delete st.fails;
      setAutoState(this.mapName, this.col as Collision, st);
    }
    const { walker, walks } = this.counts(st);
    this.set({ state: "done", percent: 100, walker, walks, text: `paths: ready, the path search walks ${walker} of ${walks} walks` });
    if (fresh) {
      const skipped = this.runSkipped === 0 ? "" : `; ${this.runSkipped} given up (more than ${Math.round(JOB_BUDGET_MS / 1000)} s of work), the swing's until a later start`;
      const heap = this.peak === null ? "" : ` (the thread's heap at most ${this.peak.heapMb} MB)`;
      this.hooks.log(`paths: built and checked for '${this.mapName}' in ${Math.round((this.now() - this.startedAt) / 1000)} s${heap}; the path search walks ${walker} of ${walks} walks, the swing the rest${skipped}`);
      this.hooks.save(true);
    }
    this.hooks.verdicts();
    if (this.pending.length > 0) this.launch(this.pending.splice(0));
  }

  private fail(st: AutoState, why: string): void {
    st.failed = why;
    st.fails = (st.fails ?? 0) + 1;
    setAutoState(this.mapName, this.col as Collision, st);
    this.hooks.save(true);
    this.set({ state: "failed", percent: 0, text: `paths: build failed (${why}); the swing stays` });
    this.hooks.log(`paths: the build for '${this.mapName}' failed (${why}); the swing stays`);
  }

  cancel(): void {
    const w = this.worker;
    this.worker = null;
    if (w !== null) {
      if (this.flags !== null) Atomics.store(this.flags, FLAG_STOP, 1);
      void w.terminate();
    }
    this.flags = null;
    this.key = null;
    this.col = null;
    this.jobs = [];
    this.pending = [];
    if (this.cur.state !== "off") this.set({ state: "off", percent: 0, walker: 0, walks: 0, text: "" });
  }

  setDuty(percent: number): void {
    const d = Math.max(1, Math.min(100, Math.round(percent)));
    if (d === this.duty) return;
    this.duty = d;
    if (this.flags !== null) Atomics.store(this.flags, FLAG_DUTY, d);
  }
  private duty = DUTY_PERCENT;

  setPaused(p: boolean): void {
    if (p === this.paused) return;
    this.paused = p;
    if (this.flags === null) return;
    Atomics.store(this.flags, FLAG_PAUSE, p ? 1 : 0);
    if (!p) Atomics.notify(this.flags, FLAG_PAUSE);
  }
}
