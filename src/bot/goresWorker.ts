import { parentPort, workerData } from "node:worker_threads";
import { readlinkSync } from "node:fs";
import { setPriority } from "node:os";
import { Collision } from "../core/collision.ts";
import { GOALS_KEPT_SOLVER, goresSource } from "../plan/goresMap.ts";
import type { CourseSource, MapSolution, SolvedSection, SolverEvent } from "../plan/goresMap.ts";
import { MapSolver, POLISH_PASSES } from "../plan/goresSolver.ts";
import type { FromGores, GoresInit } from "./goresThread.ts";
import { FLAG_BEAT, FLAG_DUTY, FLAG_PAUSE, FLAG_SLEEP, FLAG_STOP } from "./goresThread.ts";
import { setFloat32 } from "../core/float.ts";

setFloat32(true);

const port = parentPort;
if (port === null) throw new Error("goresWorker.ts runs only as a worker thread");
const init = workerData as GoresInit;
const post = (m: FromGores): void => port.postMessage(m);

const PROGRESS_MS = 2000;

try {
  const tid = Number(readlinkSync("/proc/thread-self").split("/").pop());
  if (Number.isInteger(tid) && tid > 0) setPriority(tid, 19);
} catch {

}

const flags = new Int32Array(init.flags);
let last = performance.now();
let owed = 0;

let lastProgress: Extract<SolverEvent, { t: "progress" }> | null = null;
let lastSent = performance.now();

let polishNews: Extract<SolverEvent, { t: "polish" }> | null = null;

function heartbeat(): void {
  const now = performance.now();
  const news = polishNews ?? lastProgress;
  if (news === null || now - lastSent < PROGRESS_MS) return;
  lastSent = now;
  post(news);
}

function gate(): void {
  Atomics.add(flags, FLAG_BEAT, 1);
  const busy = performance.now() - last;
  heartbeat();
  while (Atomics.load(flags, FLAG_PAUSE) === 1 && Atomics.load(flags, FLAG_STOP) === 0) Atomics.wait(flags, FLAG_PAUSE, 1, 250);
  const duty = Atomics.load(flags, FLAG_DUTY);
  if (duty > 0 && duty < 100) {
    owed += (busy * (100 - duty)) / duty;
    if (owed >= 2) {
      const sleep = Math.min(250, owed);
      Atomics.wait(flags, FLAG_SLEEP, 0, sleep);
      owed -= sleep;
    }
  }
  last = performance.now();
}

const own = (sec: SolvedSection): SolvedSection => ({ ...sec, startState: sec.startState.slice(), endState: sec.endState.slice() });

function forward(solver: MapSolver): boolean {
  let over = false;
  for (const taken of solver.takeEvents()) {
    let ev = taken;
    if (ev.t === "progress") lastProgress = ev;
    else if (ev.t === "section") {

      if (lastProgress !== null) lastProgress = { ...lastProgress, done: ev.idx + 1, total: Math.max(lastProgress.total, ev.idx + 1) };
      ev = { ...ev, sec: own(ev.sec) };
    } else if (ev.t === "done") ev = { ...ev, sol: { ...ev.sol, sections: ev.sol.sections.map(own) } };
    lastSent = performance.now();
    post(ev);
    if (ev.t === "done" || ev.t === "failed") over = true;
  }
  return over;
}

function polishPass(col: Collision, source: CourseSource, index: number, total: number, resume: MapSolution | null): { sol: MapSolution | null; stopped: boolean } {
  const say = (done: number, of: number): void => {
    polishNews = { t: "polish", pass: index + 1, of: POLISH_PASSES.length, done, total: of };
    lastSent = performance.now();
    post(polishNews);
  };

  say(0, total);
  const pass = new MapSolver(col, source, { ...init.solverOpts, fieldV: POLISH_PASSES[index].fieldV }, resume, gate);
  const run = pass.run();
  let step = run.next();
  while (step.done !== true) {
    for (const ev of pass.takeEvents()) {
      if (ev.t === "progress") say(ev.done, ev.total);
      else if (ev.t === "section") {
        lastSent = performance.now();
        post({ t: "polishSection", pass: index, idx: ev.idx, sec: own(ev.sec) });
      }
    }
    gate();
    if (Atomics.load(flags, FLAG_STOP) === 1) return { sol: null, stopped: true };
    step = run.next();
  }
  return { sol: step.value.complete ? step.value : null, stopped: false };
}

function polish(col: Collision, source: CourseSource, first: MapSolution): void {
  let best = first;
  for (let i = first.polish ?? 0; i < POLISH_PASSES.length; i++) {
    let faster = false;

    let note: string | undefined;
    try {
      const kept = init.polishResume ?? null;
      const resume = kept !== null && kept.pass === i ? kept.sol : null;
      const r = polishPass(col, source, i, best.total, resume);
      if (r.stopped) return;
      if (r.sol !== null && r.sol.bestTicks < best.bestTicks) {
        best = r.sol;
        faster = true;
      }
    } catch (err) {

      note = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    }
    best = { ...best, polish: i + 1 };
    lastSent = performance.now();
    post({ t: "improved", sol: { ...best, sections: best.sections.map(own) }, faster, ...(note === undefined ? {} : { note }) });
  }
}

let solver: MapSolver | null = null;

function main(): void {

  gate();
  const col = Collision.fromSnapshot(init.snapshot);
  const source = goresSource(col, GOALS_KEPT_SOLVER);
  if (source === null) {
    post({ t: "failed", why: "no course" });
    return;
  }

  if (init.resume !== null && init.resume.complete) {
    if (init.polish !== false) polish(col, source, init.resume);
    return;
  }

  const had = init.resume === null ? 0 : init.resume.solvedPrefix;
  lastProgress = { t: "progress", done: had, total: init.resume === null ? 0 : init.resume.total, section: had, level: 0, note: "starting" };
  post(lastProgress);
  lastSent = performance.now();
  solver = new MapSolver(col, source, init.solverOpts, init.resume, gate);
  const run = solver.run();
  let step = run.next();
  while (step.done !== true) {
    if (forward(solver)) return;
    gate();
    if (Atomics.load(flags, FLAG_STOP) === 1) return;
    step = run.next();
  }

  if (!forward(solver)) post({ t: "done", sol: step.value });

  if (step.value.complete && init.polish !== false) polish(col, source, step.value);
}

try {
  main();
} catch (err) {
  try {

    if (solver !== null) forward(solver);
  } catch {

  }
  try {
    post({ t: "failed", why: err instanceof Error ? err.message : String(err), lost: true });
  } catch {

  }
}
