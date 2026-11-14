import { Worker } from "node:worker_threads";
import type { Collision, CollisionSnapshot } from "../core/collision.ts";
import { FLAT_STRIDE } from "../core/world.ts";
import { PHYSICS_VERSION, SOLUTION_VERSION } from "../plan/goresMap.ts";
import type { MapSolution, SolvedSection, SolverEvent, SolverOpts } from "../plan/goresMap.ts";
import { POLISH_PASSES } from "../plan/goresMap.ts";

export const FLAG_PAUSE = 0;
export const FLAG_STOP = 1;

export const FLAG_DUTY = 2;

export const FLAG_SLEEP = 3;

export const FLAG_BEAT = 4;
export const FLAG_COUNT = 5;

export const DUTY_PERCENT = 60;

export const SPARE_DUTY_PERCENT = 90;

export const GORES_LOW_DUTY_PERCENT = 25;

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

  polish?: boolean;

  polishResume?: { pass: number; sol: MapSolution } | null;
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

  polishing: boolean;
  text: string;
};

type WorkerLike = Pick<Worker, "on" | "postMessage" | "terminate">;

export type GoresHostOpts = {
  makeWorker?: (init: GoresInit) => WorkerLike;

  plays?: (sol: MapSolution) => boolean;

  polish?: boolean;

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
    o.copiesHeld <= 1 &&
    (o.tele === undefined || o.tele === true)
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
    isNum(o.attempts) &&

    (o.polish === undefined || isIdx(o.polish))
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
      return typeof o.why === "string" && (o.lost === undefined || o.lost === true) ? null : "bad failure";
    case "polishSection":
      return isIdx(o.pass) && isIdx(o.idx) && validSection(o.sec) && o.sec.idx === o.idx ? null : "bad polish section";
    case "polish":
      return isIdx(o.pass) && isIdx(o.of) && isIdx(o.done) && isIdx(o.total) && o.done <= o.total ? null : "bad polish";

    case "improved":
      return typeof o.faster === "boolean" && (o.note === undefined || typeof o.note === "string") ? null : "bad improved";
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
  private cur: GoresSolveStatus = { state: "off", done: 0, total: 0, level: 0, attempts: 0, bestTicks: 0, complete: false, polishing: false, text: "" };
  private paused = false;
  private duty: number;
  private readonly heap: number;

  private forKey = "";
  private base: MapSolution | null = null;
  private opts: Partial<SolverOpts> = {};
  private prefix: SolvedSection[] = [];
  private freshFrom = Infinity;
  private whole: MapSolution | null = null;
  private partial: MapSolution | null = null;
  private polishNews: { pass: number; of: number; done: number; total: number } | null = null;
  private improved: { sol: MapSolution; faster: boolean } | null = null;

  private polishPrefix: { pass: number; sections: SolvedSection[] } | null = null;
  private polishSol: MapSolution | null = null;

  private polishNote = "";

  private lostThread = false;
  private readonly plays: ((sol: MapSolution) => boolean) | null;
  private readonly polishOn: boolean;

  constructor(opts: GoresHostOpts = {}) {
    this.heap = goresHeapMb(opts.heapMb);
    this.duty = dutyOf(opts.duty ?? DUTY_PERCENT);
    this.makeWorker = opts.makeWorker ?? ((init) => realWorker(init, this.heap));
    this.plays = opts.plays ?? null;
    this.polishOn = opts.polish !== false;
  }

  get improvedPending(): boolean {
    return this.improved !== null;
  }

  status(): GoresSolveStatus {
    return this.cur;
  }

  polishPartial(): { pass: number; sol: MapSolution } | null {
    const p = this.polishPrefix;
    const b = this.whole;
    if (p === null || b === null || p.sections.length === 0) return null;
    this.polishSol ??= {
      version: SOLUTION_VERSION,
      physicsVersion: PHYSICS_VERSION,
      key: this.forKey,
      cutEvery: b.cutEvery,
      sections: p.sections.slice(),
      solvedPrefix: p.sections.length,
      total: Math.max(b.total, p.sections.length),
      complete: false,
      bestTicks: sumTicks(p.sections),
      attempts: 0,
    };
    return { pass: p.pass, sol: this.polishSol };
  }

  get running(): boolean {
    return this.worker !== null;
  }

  get key(): string {
    return this.forKey;
  }

  get threadLost(): boolean {
    return this.cur.state === "failed" && this.lostThread;
  }

  solution(): MapSolution | null {
    if (this.whole !== null) return this.whole;
    if (this.partial === null && this.prefix.length > 0) {
      const b = this.base;
      this.partial = {
        version: SOLUTION_VERSION,
        physicsVersion: PHYSICS_VERSION,
        key: this.forKey,
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

  takeImproved(): { sol: MapSolution; faster: boolean } | null {
    const i = this.improved;
    this.improved = null;
    return i;
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

  private doneText(sol: MapSolution, polishing: boolean): string {
    const plain = sol.complete ? `solved, ${sol.bestTicks} ticks` : `solved ${sol.solvedPrefix} of ${sol.total} sections, ${sol.bestTicks} ticks so far`;

    const base = this.polishNote === "" ? plain : `${plain} (a search for a faster route stopped: ${this.polishNote})`;
    if (!polishing) return base;
    const p = this.polishNews;
    const pass = p?.pass ?? Math.min((sol.polish ?? 0) + 1, POLISH_PASSES.length);
    const of = p?.of ?? POLISH_PASSES.length;
    return `${base}; looking for a faster route (pass ${pass} of ${of}${p !== null && p.total > 0 ? `, ${p.done} of ${p.total}` : ""})`;
  }

  start(col: Collision, key: string, resume: MapSolution | null, solverOpts: Partial<SolverOpts> = {}, polishResume: { pass: number; sol: MapSolution } | null = null): void {
    if (this.worker !== null && this.forKey === key) return;
    if (resume !== null && (!validSolution(resume) || resume.key !== key || resume.physicsVersion !== PHYSICS_VERSION)) resume = null;

    const polishOnly = this.polishOn && resume !== null && resume.complete && (resume.polish ?? 0) < POLISH_PASSES.length;
    if (resume !== null && resume.complete && !polishOnly) {
      const was = this.cur.state;
      this.stop();
      if (was !== "off") this.changed();
      return;
    }
    this.stop();
    const goOn =
      polishOnly &&
      resume !== null &&
      polishResume !== null &&
      polishResume.pass === (resume.polish ?? 0) &&
      validSolution(polishResume.sol) &&
      polishResume.sol.key === key &&
      polishResume.sol.physicsVersion === PHYSICS_VERSION &&
      polishResume.sol.version === SOLUTION_VERSION &&
      !polishResume.sol.complete &&
      polishResume.sol.sections.length > 0
        ? polishResume
        : null;
    this.forKey = key;
    this.lostThread = false;
    this.base = resume;
    this.opts = solverOpts;
    this.prefix = resume === null ? [] : resume.sections.slice();
    this.freshFrom = Infinity;
    this.whole = null;
    this.partial = null;
    this.polishPrefix = goOn === null ? null : { pass: goOn.pass, sections: goOn.sol.sections.slice() };
    this.polishSol = null;
    const done = this.prefix.length;
    const total = resume === null ? 0 : resume.total;
    this.cur = { state: "solving", done, total, level: 0, attempts: resume?.attempts ?? 0, bestTicks: sumTicks(this.prefix), complete: false, polishing: false, text: "" };
    this.cur.text = total > 0 ? this.text() : "solving: starting";
    if (polishOnly && resume !== null) {

      this.whole = resume;
      this.cur = { ...this.cur, state: "done", complete: true, polishing: true, text: this.doneText(resume, true) };
    }
    let worker: WorkerLike;
    try {
      const buffer = new SharedArrayBuffer(FLAG_COUNT * 4);
      const flags = new Int32Array(buffer);
      flags[FLAG_PAUSE] = this.paused ? 1 : 0;
      flags[FLAG_DUTY] = this.duty;
      this.flags = flags;
      worker = this.makeWorker({ key, snapshot: col.snapshot(), resume, solverOpts, flags: buffer, polish: this.polishOn, polishResume: goOn });
    } catch (err) {
      this.flags = null;
      this.lost(err instanceof Error ? err.message : String(err));
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
          this.lost(`bad message from the thread (${bad})`);
          return;
        }
        this.onMessage(m as FromGores, worker);
      } catch (err) {
        this.end(worker);
        try {
          this.lost(err instanceof Error ? err.message : String(err));
        } catch {

        }
      }
    });

    worker.on("messageerror", () => {
      if (this.worker !== worker) return;
      this.end(worker);
      this.lost("a message from the thread could not be read");
    });
    worker.on("error", (err: unknown) => {
      if (this.worker !== worker) return;
      this.worker = null;
      this.lost(err instanceof Error ? err.message : String(err));
    });
    worker.on("exit", (code: number) => {
      if (this.worker !== worker) return;
      this.worker = null;
      this.lost(code === 0 ? "the thread ended with no result" : `the thread ended (code ${code})`);
    });
  }

  private end(worker: WorkerLike): void {
    if (this.worker === worker) this.worker = null;
    void worker.terminate();
  }

  private onMessage(m: FromGores, worker: WorkerLike): void {
    switch (m.t) {
      case "progress":

        if (this.whole !== null) return;
        this.partial = null;
        this.set({ done: m.done, total: m.total, level: m.level, text: m.total > 0 ? `solved ${m.done} of ${m.total} sections` : "solving: starting" });
        return;
      case "section": {
        if (this.whole !== null) return;

        if (m.idx > this.prefix.length) {
          this.end(worker);
          this.lost(`thread sent section ${m.idx} after ${this.prefix.length}`);
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

        if (this.whole !== null) {
          this.end(worker);
          this.lost("a second result from the thread");
          return;
        }

        if (m.sol.physicsVersion !== PHYSICS_VERSION) {
          this.end(worker);
          this.fail(`the thread's solution is of physics ${m.sol.physicsVersion}, the bot's is ${PHYSICS_VERSION}`);
          return;
        }

        const polishes = this.polishOn && m.sol.complete && (m.sol.polish ?? 0) < POLISH_PASSES.length;
        if (!polishes) this.end(worker);
        const sol: MapSolution = { ...m.sol, key: this.forKey, version: SOLUTION_VERSION };
        this.whole = sol;
        this.prefix = sol.sections.slice();
        this.freshFrom = Infinity;
        this.partial = null;
        this.polishNews = null;
        this.set({ state: "done", done: sol.solvedPrefix, total: sol.total, attempts: sol.attempts, bestTicks: sol.bestTicks, complete: sol.complete, polishing: polishes, text: this.doneText(sol, polishes) });
        return;
      }
      case "failed":

        this.end(worker);
        this.lost(m.why, m.lost === true);
        return;
      case "polish":

        if (this.whole === null || !this.cur.polishing) return;
        this.polishNews = { pass: m.pass, of: m.of, done: m.done, total: m.total };
        this.set({ text: this.doneText(this.whole, true) });
        return;
      case "polishSection": {

        if (this.whole === null || !this.cur.polishing || m.pass !== (this.whole.polish ?? 0)) return;
        if (this.polishPrefix === null || this.polishPrefix.pass !== m.pass) this.polishPrefix = { pass: m.pass, sections: [] };
        const have = this.polishPrefix.sections;
        if (m.idx > have.length) {
          this.end(worker);
          this.lost(`thread sent polish section ${m.idx} after ${have.length}`);
          return;
        }
        have.length = m.idx;
        have.push(m.sec);
        this.polishSol = null;
        return;
      }
      case "improved": {

        if (this.whole !== null) {
          this.polishPrefix = null;
          this.polishSol = null;
        }

        if (this.whole === null || !validSolution(m.sol) || m.sol.physicsVersion !== PHYSICS_VERSION || !m.sol.complete) return;

        if (this.whole.complete && m.sol.bestTicks > this.whole.bestTicks) return;

        const claims = !this.whole.complete || m.sol.bestTicks < this.whole.bestTicks;
        let given: MapSolution = claims ? m.sol : { ...this.whole, polish: m.sol.polish };
        let faster = claims;
        if (faster && this.plays !== null) {
          let ok = false;
          try {
            ok = this.plays({ ...m.sol, key: this.forKey, version: SOLUTION_VERSION });
          } catch {
            ok = false;
          }
          if (!ok) {

            given = { ...this.whole, polish: m.sol.polish };
            faster = false;
          }
        }
        const sol: MapSolution = { ...given, key: this.forKey, version: SOLUTION_VERSION };
        const over = (sol.polish ?? 0) >= POLISH_PASSES.length;
        if (typeof m.note === "string" && m.note !== "") this.polishNote = m.note.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 200);
        if (over) this.end(worker);
        this.whole = sol;
        this.prefix = sol.sections.slice();
        this.freshFrom = Infinity;
        this.partial = null;
        this.polishNews = null;

        this.improved = { sol, faster: faster || (this.improved?.faster ?? false) };
        this.set({ done: sol.solvedPrefix, total: sol.total, attempts: sol.attempts, bestTicks: sol.bestTicks, complete: true, polishing: !over, text: this.doneText(sol, !over) });
        return;
      }
    }
  }

  private fail(why: string): void {
    this.set({ state: "failed", text: `failed: ${why}`, polishing: false });
  }

  private lost(why: string, thread = true): void {
    if (this.whole === null) {
      this.lostThread = thread;
      this.fail(why);
      return;
    }
    this.polishNews = null;
    this.set({ polishing: false, text: this.doneText(this.whole, false) });
  }

  private stop(): void {
    const w = this.worker;
    this.worker = null;
    if (w !== null) {
      if (this.flags !== null) Atomics.store(this.flags, FLAG_STOP, 1);
      void w.terminate();
    }
    this.flags = null;
    this.forKey = "";
    this.lostThread = false;
    this.base = null;
    this.opts = {};
    this.prefix = [];
    this.freshFrom = Infinity;
    this.whole = null;
    this.partial = null;
    this.polishNews = null;
    this.improved = null;
    this.polishPrefix = null;
    this.polishSol = null;
    this.polishNote = "";
    this.cur = { state: "off", done: 0, total: 0, level: 0, attempts: 0, bestTicks: 0, complete: false, polishing: false, text: "" };
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
