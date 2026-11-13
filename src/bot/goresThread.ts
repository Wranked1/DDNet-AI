import { Worker } from "node:worker_threads";
import type { Collision, CollisionSnapshot } from "../core/collision.ts";
import { FLAT_STRIDE } from "../core/world.ts";
import { PHYSICS_VERSION, SOLUTION_VERSION } from "../plan/goresMap.ts";
import type { MapSolution, SolvedSection, SolverEvent, SolverOpts } from "../plan/goresMap.ts";

export const FLAG_PAUSE = 0;
export const FLAG_STOP = 1;

export const FLAG_DUTY = 2;

export const FLAG_SLEEP = 3;

export const FLAG_BEAT = 4;
export const FLAG_COUNT = 5;

export const DUTY_PERCENT = 60;

export const HEAP_MB = 768;
export const MAX_HEAP_MB = 1536;
const MIN_HEAP_MB = 64;

function dutyOf(share: number): number {
  return Number.isFinite(share) ? Math.max(1, Math.min(100, Math.round(share))) : DUTY_PERCENT;
}

export function goresHeapMb(mb: number | undefined): number {
  if (mb === undefined || !Number.isFinite(mb)) return HEAP_MB;
  return Math.max(MIN_HEAP_MB, Math.min(MAX_HEAP_MB, Math.round(mb)));
}

export type GoresInit = {
  key: string;
  snapshot: CollisionSnapshot;

  resume: MapSolution | null;
  solverOpts: Partial<SolverOpts>;
  flags: SharedArrayBuffer;
};

export type FromGores = SolverEvent;

export type GoresSolveStatus = {
  state: "off" | "solving" | "done" | "failed";

  done: number;
  total: number;

  level: number;
  attempts: number;

  bestTicks: number;
  complete: boolean;
  text: string;
};

type WorkerLike = Pick<Worker, "on" | "postMessage" | "terminate">;

export type GoresHostOpts = {
  makeWorker?: (init: GoresInit) => WorkerLike;

  heapMb?: number;
  duty?: number;
};

function realWorker(init: GoresInit, heapMb: number): WorkerLike {

  const worker = new Worker(new URL("./goresWorker.ts", import.meta.url), {
    workerData: init,
    resourceLimits: { maxOldGenerationSizeMb: heapMb, maxYoungGenerationSizeMb: 48 },
  });
  worker.unref();
  return worker;
}

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isIdx = (x: unknown): x is number => isNum(x) && Number.isInteger(x) && x >= 0;
const isArr = (x: unknown): x is unknown[] => Array.isArray(x);
const isState = (x: unknown): x is Float64Array => x instanceof Float64Array && x.length === FLAT_STRIDE && x.every(Number.isFinite);
const isInts = (x: unknown): x is number[] => isArr(x) && x.every((v) => typeof v === "number" && Number.isInteger(v));

const DEFAULT_CUT = 24;

function validSection(s: unknown): s is SolvedSection {
  if (typeof s !== "object" || s === null) return false;
  const o = s as Record<string, unknown>;
  return (
    isIdx(o.idx) &&
    isIdx(o.from) &&
    isIdx(o.to) &&
    o.from <= o.to &&
    isState(o.startState) &&
    isState(o.endState) &&
    isInts(o.codes) &&
    isInts(o.edgeTicks) &&
    o.codes.length === o.edgeTicks.length &&
    isArr(o.inputs) &&
    isIdx(o.ticks) &&
    isNum(o.ahead) &&
    isNum(o.copiesHeld) &&
    o.copiesHeld >= 0 &&
    o.copiesHeld <= 1
  );
}

function validSolution(s: unknown): s is MapSolution {
  if (typeof s !== "object" || s === null) return false;
  const o = s as Record<string, unknown>;
  return (
    isNum(o.version) &&
    isNum(o.physicsVersion) &&
    typeof o.key === "string" &&
    isNum(o.cutEvery) &&
    isArr(o.sections) &&
    o.sections.every((sec, i) => validSection(sec) && sec.idx === i) &&
    isIdx(o.solvedPrefix) &&
    o.solvedPrefix === o.sections.length &&
    isIdx(o.total) &&
    o.total >= o.solvedPrefix &&
    typeof o.complete === "boolean" &&
    isNum(o.bestTicks) &&
    isNum(o.attempts)
  );
}

function checkMessage(m: unknown): string | null {
  if (typeof m !== "object" || m === null) return "not an object";
  const o = m as Record<string, unknown>;
  switch (o.t) {
    case "progress":
      return isIdx(o.done) && isIdx(o.total) && o.done <= o.total && isIdx(o.section) && isIdx(o.level) && typeof o.note === "string" ? null : "bad progress";
    case "section":
      return isIdx(o.idx) && validSection(o.sec) && o.sec.idx === o.idx ? null : "bad section";
    case "done":
      return validSolution(o.sol) ? null : "bad solution";
    case "failed":
      return typeof o.why === "string" ? null : "bad failure";
    default:
      return `unknown message ${String(o.t)}`;
  }
}

const sumTicks = (secs: SolvedSection[]): number => secs.reduce((a, s) => a + s.ticks, 0);

export class GoresSolveHost {
  onChange?: () => void;
  private readonly makeWorker: (init: GoresInit) => WorkerLike;
  private worker: WorkerLike | null = null;
  private flags: Int32Array | null = null;
  private cur: GoresSolveStatus = { state: "off", done: 0, total: 0, level: 0, attempts: 0, bestTicks: 0, complete: false, text: "" };
  private paused = false;
  private duty: number;
  private readonly heap: number;

  private key = "";
  private base: MapSolution | null = null;
  private opts: Partial<SolverOpts> = {};
  private prefix: SolvedSection[] = [];
  private freshFrom = Infinity;
  private whole: MapSolution | null = null;
  private partial: MapSolution | null = null;

  constructor(opts: GoresHostOpts = {}) {
    this.heap = goresHeapMb(opts.heapMb);
    this.duty = dutyOf(opts.duty ?? DUTY_PERCENT);
    this.makeWorker = opts.makeWorker ?? ((init) => realWorker(init, this.heap));
  }

  status(): GoresSolveStatus {
    return this.cur;
  }

  get running(): boolean {
    return this.worker !== null;
  }

  solution(): MapSolution | null {
    if (this.whole !== null) return this.whole;
    if (this.partial === null && this.prefix.length > 0) {
      const b = this.base;
      this.partial = {
        version: SOLUTION_VERSION,
        physicsVersion: PHYSICS_VERSION,
        key: this.key,
        cutEvery: b?.cutEvery ?? this.opts.cutEvery?.[0] ?? DEFAULT_CUT,
        sections: this.prefix.slice(),
        solvedPrefix: this.prefix.length,
        total: Math.max(this.cur.total, this.prefix.length),
        complete: false,
        bestTicks: sumTicks(this.prefix),
        attempts: this.cur.attempts,
      };
    }
    return this.partial;
  }

  takeSections(): { from: number; sections: SolvedSection[] } | null {
    const from = this.freshFrom;
    this.freshFrom = Infinity;
    if (from > this.prefix.length || this.whole !== null) return null;
    return { from, sections: this.prefix.slice(from) };
  }

  private set(s: Partial<GoresSolveStatus>): void {
    this.cur = { ...this.cur, ...s };
    this.changed();
  }

  private changed(): void {

    try {
      this.onChange?.();
    } catch {

    }
  }

  private text(): string {
    const c = this.cur;
    return `solved ${c.done} of ${c.total} sections`;
  }

  start(col: Collision, key: string, resume: MapSolution | null, solverOpts: Partial<SolverOpts> = {}): void {
    if (this.worker !== null && this.key === key) return;
    if (resume !== null && (!validSolution(resume) || resume.key !== key || resume.physicsVersion !== PHYSICS_VERSION)) resume = null;
    this.stop();
    this.key = key;
    this.base = resume;
    this.opts = solverOpts;
    this.prefix = resume === null ? [] : resume.sections.slice();
    this.freshFrom = Infinity;
    this.whole = null;
    this.partial = null;
    const done = this.prefix.length;
    const total = resume === null ? 0 : resume.total;
    this.cur = { state: "solving", done, total, level: 0, attempts: resume?.attempts ?? 0, bestTicks: sumTicks(this.prefix), complete: false, text: "" };
    this.cur.text = total > 0 ? this.text() : "solving: starting";
    let worker: WorkerLike;
    try {
      const buffer = new SharedArrayBuffer(FLAG_COUNT * 4);
      const flags = new Int32Array(buffer);
      flags[FLAG_PAUSE] = this.paused ? 1 : 0;
      flags[FLAG_DUTY] = this.duty;
      this.flags = flags;
      worker = this.makeWorker({ key, snapshot: col.snapshot(), resume, solverOpts, flags: buffer });
    } catch (err) {
      this.flags = null;
      this.fail(err instanceof Error ? err.message : String(err));
      return;
    }
    this.worker = worker;
    this.changed();
    worker.on("message", (m: unknown) => {
      if (this.worker !== worker) return;

      try {
        const bad = checkMessage(m);
        if (bad !== null) {
          this.end(worker);
          this.fail(`bad message from the thread (${bad})`);
          return;
        }
        this.onMessage(m as FromGores, worker);
      } catch (err) {
        this.end(worker);
        try {
          this.fail(err instanceof Error ? err.message : String(err));
        } catch {

        }
      }
    });

    worker.on("messageerror", () => {
      if (this.worker !== worker) return;
      this.end(worker);
      this.fail("a message from the thread could not be read");
    });
    worker.on("error", (err: unknown) => {
      if (this.worker !== worker) return;
      this.worker = null;
      this.fail(err instanceof Error ? err.message : String(err));
    });
    worker.on("exit", (code: number) => {
      if (this.worker !== worker) return;
      this.worker = null;
      this.fail(code === 0 ? "the thread ended with no result" : `the thread ended (code ${code})`);
    });
  }

  private end(worker: WorkerLike): void {
    if (this.worker === worker) this.worker = null;
    void worker.terminate();
  }

  private onMessage(m: FromGores, worker: WorkerLike): void {
    switch (m.t) {
      case "progress":
        this.partial = null;
        this.set({ done: m.done, total: m.total, level: m.level, text: m.total > 0 ? `solved ${m.done} of ${m.total} sections` : "solving: starting" });
        return;
      case "section": {

        if (m.idx > this.prefix.length) {
          this.end(worker);
          this.fail(`thread sent section ${m.idx} after ${this.prefix.length}`);
          return;
        }
        this.prefix.length = m.idx;
        this.prefix.push(m.sec);
        this.freshFrom = Math.min(this.freshFrom, m.idx);
        this.partial = null;
        const total = Math.max(this.cur.total, this.prefix.length);
        this.set({ done: this.prefix.length, total, bestTicks: sumTicks(this.prefix), text: `solved ${this.prefix.length} of ${total} sections` });
        return;
      }
      case "done": {
        this.end(worker);

        if (m.sol.physicsVersion !== PHYSICS_VERSION) {
          this.fail(`the thread's solution is of physics ${m.sol.physicsVersion}, the bot's is ${PHYSICS_VERSION}`);
          return;
        }
        const sol: MapSolution = { ...m.sol, key: this.key, version: SOLUTION_VERSION };
        this.whole = sol;
        this.prefix = sol.sections.slice();
        this.freshFrom = Infinity;
        this.partial = null;
        const text = sol.complete ? `solved, ${sol.bestTicks} ticks` : `solved ${sol.solvedPrefix} of ${sol.total} sections, ${sol.bestTicks} ticks so far`;
        this.set({ state: "done", done: sol.solvedPrefix, total: sol.total, attempts: sol.attempts, bestTicks: sol.bestTicks, complete: sol.complete, text });
        return;
      }
      case "failed":
        this.end(worker);
        this.fail(m.why);
        return;
    }
  }

  private fail(why: string): void {
    this.set({ state: "failed", text: `failed: ${why}` });
  }

  private stop(): void {
    const w = this.worker;
    this.worker = null;
    if (w !== null) {
      if (this.flags !== null) Atomics.store(this.flags, FLAG_STOP, 1);
      void w.terminate();
    }
    this.flags = null;
    this.key = "";
    this.base = null;
    this.opts = {};
    this.prefix = [];
    this.freshFrom = Infinity;
    this.whole = null;
    this.partial = null;
    this.cur = { state: "off", done: 0, total: 0, level: 0, attempts: 0, bestTicks: 0, complete: false, text: "" };
  }

  cancel(): void {
    const was = this.cur.state;
    this.stop();
    if (was !== "off") this.changed();
  }

  setDuty(share: number): void {
    const d = dutyOf(share);
    if (d === this.duty) return;
    this.duty = d;
    if (this.flags !== null) Atomics.store(this.flags, FLAG_DUTY, d);
  }

  setPaused(on: boolean): void {
    if (on === this.paused) return;
    this.paused = on;
    if (this.flags === null) return;
    Atomics.store(this.flags, FLAG_PAUSE, on ? 1 : 0);
    if (!on) Atomics.notify(this.flags, FLAG_PAUSE);
  }
}
