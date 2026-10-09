import { parentPort, workerData } from "node:worker_threads";
import { readlinkSync } from "node:fs";
import { setPriority } from "node:os";
import { getHeapStatistics } from "node:v8";
import { Collision } from "../core/collision.ts";
import { wayblockFor } from "./wayblock.ts";
import { isStopped, runAutoBuild } from "../plan/libraryBuild.ts";
import type { AutoInit, FromBuilder } from "./libraryThread.ts";
import { FLAG_BEAT, FLAG_DUTY, FLAG_PAUSE, FLAG_SLEEP, FLAG_STOP } from "./libraryThread.ts";

const port = parentPort;
if (port === null) throw new Error("libraryWorker.ts runs only as a worker thread");
const init = workerData as AutoInit;
const post = (m: FromBuilder): void => port.postMessage(m);

try {
  const tid = Number(readlinkSync("/proc/thread-self").split("/").pop());
  if (Number.isInteger(tid) && tid > 0) setPriority(tid, 19);
} catch {

}

const flags = new Int32Array(init.flags);
let last = performance.now();
let owed = 0;
let steps = 0;
let peakHeap = 0;

function gate(): void {
  Atomics.add(flags, FLAG_BEAT, 1);
  const busy = performance.now() - last;
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
  if ((++steps & 1023) === 0) peakHeap = Math.max(peakHeap, getHeapStatistics().used_heap_size);
  last = performance.now();
}

try {

  gate();
  const col = Collision.fromSnapshot(init.snapshot);

  const def = wayblockFor(init.mapName, col);
  runAutoBuild(init.mapName, col, def?.crossings ?? [], init.jobs, init.spec, new Set(init.built), new Set(init.checked), init.have, {
    gate,
    stop: () => Atomics.load(flags, FLAG_STOP) === 1,
    progress: (done, total, phase) => post({ t: "progress", done, total, phase }),
    delta: (job, add) => post({ t: "delta", id: job.id, add }),
    built: (job) => post({ t: "built", id: job.id }),
    checked: (job, verdict) => post({ t: "checked", id: job.id, verdict }),
    skipped: (job) => post({ t: "skipped", id: job.id }),
  });
  peakHeap = Math.max(peakHeap, getHeapStatistics().used_heap_size);
  post({ t: "done", peakHeapMb: Math.round(peakHeap / 1048576), maxRssMb: Math.round(process.resourceUsage().maxRSS / 1024) });
} catch (err) {
  if (!isStopped(err)) post({ t: "failed", why: err instanceof Error ? err.message : String(err) });
}
