import { Worker } from "node:worker_threads";
import type { BotConfig, BotLine, BotStatus } from "./bot.ts";
import { safeSkinName } from "./webAssets.ts";
import { t } from "../i18n.ts";

const DUMMY_CLAN_BYTES = 11;

export type DummyStatus = {
  phase: "offline" | "connecting" | "online";
  frozen: boolean;
  acting: boolean;
  mode: "fight" | "passive" | "hold" | "goto";
  wb: string | null;
  target: string | null;

  selfId: number;

  duelScore: { name: string; ours: number; theirs: number } | null;

  panel: BotStatus["panel"] | null;
  blocks: number;
  blockedBy: number;

  kills: number;
  deaths: number;
  hooks: number;
};

export function dummyStatusView(name: string, d: DummyStatus) {
  return {
    name,
    phase: d.phase,
    frozen: d.frozen,
    acting: d.acting,
    mode: d.mode,
    wb: d.wb,
    target: d.target,
    id: d.selfId,
    duelScore: d.duelScore,
    panel: d.panel,
    blocks: d.blocks,
    blockedBy: d.blockedBy,
    kills: d.kills,
    deaths: d.deaths,
    hooks: d.hooks,
  };
}

type List = "war" | "friend" | "ignore";

export type DummyInit = {

  cfg: Omit<BotConfig, "opponentDirNet" | "policy">;
  opponentFile?: string;
  relations: [List, string][];

  teammate?: string;

  teammateLocal?: string;

  teammateLocalClan?: string;

  lang?: "ru" | "en";
};

export type ToDummy =
  | { t: "start" }
  | { t: "stop" }
  | { t: "console"; id: number; line: string }
  | { t: "relation"; list: List; name: string; on: boolean }
  | { t: "partner"; id: number | null };

export type FromDummy =
  | { t: "out"; line: BotLine }
  | { t: "status"; status: DummyStatus }

  | { t: "reply"; id: number; text: string; pinned?: string | null }
  | { t: "stopped" };

export function shareableLists(info: Partial<Record<List, string[]>>, exclude: string[]): Map<string, [List, string]> {
  const out = new Map<string, [List, string]>();
  const skip = new Set(exclude.map((n) => n.toLowerCase()));
  for (const list of ["war", "friend", "ignore"] as const) {
    for (const n of info[list] ?? []) if (!skip.has(n.toLowerCase())) out.set(`${list}\u0000${n.toLowerCase()}`, [list, n]);
  }
  return out;
}

export function listUpdates(prev: Map<string, [List, string]>, now: Map<string, [List, string]>): [List, string, boolean][] {
  const out: [List, string, boolean][] = [];
  for (const [key, [list, n]] of prev) if (!now.has(key)) out.push([list, n, false]);
  const removed = out.length > 0;
  for (const [key, [list, n]] of now) if (removed || !prev.has(key)) out.push([list, n, true]);
  return out;
}

export function targetRoute(line: string): { both: boolean; line: string; arg: string } | null {
  const m = /^\s*[!?](target1?)(?:\s+(.*))?$/i.exec(line);
  if (m === null) return null;
  const arg = (m[2] ?? "").trim();
  return { both: m[1].toLowerCase() === "target", line: arg === "" ? "!target" : `!target ${arg}`, arg };
}

export function routeTarget(line: string, own: (line: string) => string, second: Pick<DummyThread, "setTarget">, secondName: string, firstHolds: () => string | undefined): string | Promise<string> | null {
  const route = targetRoute(line);
  if (route === null) return null;
  const reply = own(route.line);
  if (!route.both) return reply;
  return second.setTarget(route.arg, firstHolds()).then((r) => `${reply}\n${secondName}: ${r}`);
}

const REPLY_TIMEOUT_MS = 5000;
const STOP_TIMEOUT_MS = 5000;

const HEAP_MB = 1536;

const RESTART_MIN_MS = 5000;
const RESTART_MAX_MS = 60000;

const HEALTHY_MS = 60000;

type WorkerLike = Pick<Worker, "on" | "postMessage" | "terminate">;

export type DummyDeps = {
  makeWorker?: (init: DummyInit) => WorkerLike;
  now?: () => number;
};

function realWorker(init: DummyInit): WorkerLike {
  return new Worker(new URL("./dummyWorker.ts", import.meta.url), {
    workerData: init,
    resourceLimits: { maxOldGenerationSizeMb: HEAP_MB },
  });
}

export class DummyThread {
  private worker!: WorkerLike;
  private readonly init: DummyInit;
  private sink: ((line: BotLine) => void) | null = null;
  private statusSink: ((s: DummyStatus) => void) | null = null;
  private last: DummyStatus = { phase: "offline", frozen: false, acting: false, mode: "passive", wb: null, target: null, selfId: -1, duelScore: null, panel: null, blocks: 0, blockedBy: 0, kills: 0, deaths: 0, hooks: 0 };
  private nextId = 1;

  private pinnedFrom = 0;
  private readonly waiting = new Map<number, (text: string) => void>();
  private onStopped: (() => void) | null = null;
  private exited = false;
  private started = false;
  private stopping: Promise<void> | null = null;
  private restartMs = RESTART_MIN_MS;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private spawnedAt = 0;
  private readonly makeWorker: (init: DummyInit) => WorkerLike;
  private readonly now: () => number;

  constructor(init: DummyInit, deps: DummyDeps = {}) {
    this.init = init;
    this.makeWorker = deps.makeWorker ?? realWorker;
    this.now = deps.now ?? Date.now;
    this.spawn();
  }

  private spawn(): void {
    this.exited = false;
    const worker = this.makeWorker(this.init);
    this.worker = worker;
    this.spawnedAt = this.now();
    worker.on("message", (m: FromDummy) => this.onMessage(m));
    worker.on("error", (err) => this.out(`the second bot stopped with an error: ${err instanceof Error ? err.message : String(err)}`));
    worker.on("exit", () => {
      if (this.worker !== worker) return;
      this.exited = true;

      if (this.now() - this.spawnedAt >= HEALTHY_MS) this.restartMs = RESTART_MIN_MS;
      this.last = { ...this.last, phase: "offline", acting: false, selfId: -1, duelScore: null };
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
        this.statusSink?.(m.status);
        return;
      case "reply": {

        if (m.pinned !== undefined && m.id >= this.pinnedFrom) this.init.cfg = { ...this.init.cfg, targetName: m.pinned ?? undefined };
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

  onStatus(sink: ((s: DummyStatus) => void) | null): void {
    this.statusSink = sink;
  }

  onOutput(sink: ((line: BotLine) => void) | null): void {
    this.sink = sink;
  }

  status(): DummyStatus {
    return this.last;
  }

  start(): Promise<void> {
    this.started = true;

    if (this.exited && this.stopping === null) {
      if (this.restartTimer !== null) {
        clearTimeout(this.restartTimer);
        this.restartTimer = null;
      }
      this.spawn();
    }
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
    const who = name.toLowerCase();
    this.init.relations = this.init.relations.filter(([l, n]) => !(l === list && n.toLowerCase() === who));
    if (on) this.init.relations.push([list, name]);
    this.send({ t: "relation", list, name, on });
  }

  setModes(lowCpu: boolean, strong: boolean): void {
    this.init.cfg = { ...this.init.cfg, lowCpu, strong };
    void this.handleConsole(lowCpu ? "!low on" : "!low off");
    void this.handleConsole(strong ? "!strong on" : "!strong off");
  }

  setHumanlike(on: boolean): void {
    this.init.cfg = { ...this.init.cfg, humanlike: on };
    void this.handleConsole(on ? "!humanlike on" : "!humanlike off");
  }

  setInputTiming(on: boolean): void {
    this.init.cfg = { ...this.init.cfg, inputTiming: on };
    void this.handleConsole(on ? "!timing on" : "!timing off");
  }

  setPreInput(on: boolean): void {
    this.init.cfg = { ...this.init.cfg, preInput: on };
    void this.handleConsole(on ? "!preinput on" : "!preinput off");
  }

  setPathfind(mode: "on" | "table" | "off"): void {
    this.init.cfg = { ...this.init.cfg, pathfind: mode };
    void this.handleConsole(`!pathfind ${mode}`);
  }

  setIdentity(patch: { clan?: string; skin?: string }): Promise<string> {
    const clan = patch.clan?.trim();
    const skin = patch.skin?.trim();
    const clanOk = clan !== undefined && Buffer.byteLength(clan, "utf8") <= DUMMY_CLAN_BYTES;
    const skinOk = skin !== undefined && (skin === "" || safeSkinName(skin) !== null);
    this.init.cfg = {
      ...this.init.cfg,
      ...(clanOk ? { clan: clan === "" ? undefined : clan } : {}),
      ...(skinOk ? { skin: skin === "" ? "default" : skin } : {}),
    };
    const lines: Promise<string>[] = [];
    if (clan !== undefined) lines.push(this.handleConsole(`!clan ${clan === "" ? "-" : clan}`));
    if (skin !== undefined) lines.push(this.handleConsole(`!skin ${skin === "" ? "default" : skin}`));
    return Promise.all(lines).then((r) => r.join("; "));
  }

  setTarget(arg: string, resolved: string | undefined): Promise<string> {
    const name = arg.trim();
    const kept = name === "" || name === "-" ? undefined : resolved;
    this.init.cfg = { ...this.init.cfg, targetName: kept };

    this.pinnedFrom = this.nextId;

    if (this.exited) return Promise.resolve(kept === undefined ? t("второй бот не запущен: запустится снова без цели") : t("второй бот не запущен: цель {name} он возьмёт, когда запустится снова", { name: kept }));
    return this.handleConsole(name === "" ? "!target" : `!target ${name}`);
  }

  setPartnerId(id: number | null): void {
    this.send({ t: "partner", id });
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
