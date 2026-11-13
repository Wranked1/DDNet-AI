import { parentPort, workerData } from "node:worker_threads";
import { readlinkSync } from "node:fs";
import { setPriority } from "node:os";
import { Collision } from "../core/collision.ts";
import { goresSource } from "../plan/goresMap.ts";
import type { SolvedSection, SolverEvent } from "../plan/goresMap.ts";
import { MapSolver } from "../plan/goresSolver.ts";
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

function heartbeat(): void {
  const now = performance.now();
  if (lastProgress === null || now - lastSent < PROGRESS_MS) return;
  lastSent = now;
  post(lastProgress);
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

let solver: MapSolver | null = null;

function main(): void {

  gate();
  const col = Collision.fromSnapshot(init.snapshot);
  const source = goresSource(col);
  if (source === null) {
    post({ t: "failed", why: "no course" });
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
}

try {
  main();
} catch (err) {
  try {

    if (solver !== null) forward(solver);
  } catch {

  }
  try {
    post({ t: "failed", why: err instanceof Error ? err.message : String(err) });
  } catch {

  }
}
