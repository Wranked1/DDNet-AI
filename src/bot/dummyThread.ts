import { Worker } from "node:worker_threads";
import type { BotConfig, BotLine } from "./bot.ts";

export type DummyStatus = {
  phase: "offline" | "connecting" | "online";
  frozen: boolean;
  acting: boolean;
  mode: "fight" | "passive" | "hold" | "goto";
  wb: string | null;
  target: string | null;
};

type List = "war" | "friend" | "ignore";

export type DummyInit = {

  cfg: Omit<BotConfig, "opponentDirNet" | "policy">;
  opponentFile?: string;
  relations: [List, string][];

  lang?: "ru" | "en";
};

export type ToDummy =
  | { t: "start" }
  | { t: "stop" }
  | { t: "console"; id: number; line: string }
  | { t: "relation"; list: List; name: string; on: boolean };

export type FromDummy =
  | { t: "out"; line: BotLine }
  | { t: "status"; status: DummyStatus }
  | { t: "reply"; id: number; text: string }
  | { t: "stopped" };

const REPLY_TIMEOUT_MS = 5000;
const STOP_TIMEOUT_MS = 5000;

const HEAP_MB = 1536;

const RESTART_MIN_MS = 5000;
const RESTART_MAX_MS = 60000;

export class DummyThread {
  private worker!: Worker;
  private readonly init: DummyInit;
  private sink: ((line: BotLine) => void) | null = null;
  private last: DummyStatus = { phase: "offline", frozen: false, acting: false, mode: "passive", wb: null, target: null };
  private nextId = 1;
  private readonly waiting = new Map<number, (text: string) => void>();
  private onStopped: (() => void) | null = null;
  private exited = false;
  private started = false;
  private stopping: Promise<void> | null = null;
  private restartMs = RESTART_MIN_MS;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(init: DummyInit) {
    this.init = init;
    this.spawn();
  }

  private spawn(): void {
    this.exited = false;
    const worker = new Worker(new URL("./dummyWorker.ts", import.meta.url), {
      workerData: this.init,
      resourceLimits: { maxOldGenerationSizeMb: HEAP_MB },
    });
    this.worker = worker;
    worker.on("message", (m: FromDummy) => this.onMessage(m));
    worker.on("error", (err) => this.out(`the second bot stopped with an error: ${err instanceof Error ? err.message : String(err)}`));
    worker.on("exit", () => {
      if (this.worker !== worker) return;
      this.exited = true;
      this.last = { ...this.last, phase: "offline", acting: false };
      for (const done of this.waiting.values()) done("the second bot is not running");
      this.waiting.clear();
      this.onStopped?.();
      if (this.stopping === null && this.started) {
        const wait = this.restartMs;
        this.restartMs = Math.min(RESTART_MAX_MS, this.restartMs * 2);
        this.out(`the second bot's thread ended; starting it again in ${Math.round(wait / 1000)}s`);
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          if (this.stopping !== null) return;
          this.spawn();
          this.send({ t: "start" });
        }, wait);
        this.restartTimer.unref?.();
      }
    });
  }

  private out(text: string): void {
    const line: BotLine = { kind: "event", text };
    if (this.sink !== null) this.sink(line);
    else console.log(text);
  }

  private onMessage(m: FromDummy): void {
    switch (m.t) {
      case "out":
        if (this.sink !== null) this.sink(m.line);
        else if (m.line.kind !== "log") console.log(m.line.text);
        return;
      case "status":
        this.last = m.status;
        return;
      case "reply": {
        const done = this.waiting.get(m.id);
        this.waiting.delete(m.id);
        done?.(m.text);
        return;
      }
      case "stopped":
        this.onStopped?.();
        return;
    }
  }

  private send(m: ToDummy): void {
    if (!this.exited) this.worker.postMessage(m);
  }

  onOutput(sink: ((line: BotLine) => void) | null): void {
    this.sink = sink;
  }

  status(): DummyStatus {
    return this.last;
  }

  start(): Promise<void> {
    this.started = true;
    this.send({ t: "start" });
    return Promise.resolve();
  }

  handleConsole(line: string): Promise<string> {
    if (this.exited) return Promise.resolve("the second bot is not running");
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        resolve("no answer from the second bot");
      }, REPLY_TIMEOUT_MS);
      this.waiting.set(id, (text) => {
        clearTimeout(timer);
        resolve(text);
      });
      this.send({ t: "console", id, line });
    });
  }

  setRelation(list: List, name: string, on: boolean): void {
    this.send({ t: "relation", list, name, on });
  }

  stop(): Promise<void> {
    if (this.stopping !== null) return this.stopping;
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.stopping = (async () => {
      if (this.exited) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, STOP_TIMEOUT_MS);
        this.onStopped = () => {
          clearTimeout(timer);
          resolve();
        };
        this.send({ t: "stop" });
      });
      await this.worker.terminate().catch(() => 0);
    })();
    return this.stopping;
  }
}
