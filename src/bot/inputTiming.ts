import { closeSync, openSync, writeSync } from "node:fs";
import { createRequire } from "node:module";
import { threadId } from "node:worker_threads";

export const TICK_MS = 20;

export const MARGIN_MS = 2;

const MARGIN_MAX_MS = 40;

export const NETMSG_INPUTTIMING = 9;

const STATE_ONLINE = 3;

const SENT_KEEP = 200;

const SPIKE_MS = -50;
const SPIKE_STEP = 5;
const SPIKE_BELIEVED = 15;
const SPIKE_CAP = 50;

const UP_RATE = 0.04;

const HOLD_KEEP = 50;
const HOLD_MIN = 10;
const HOLD_QUANTILE = 0.9;
const HOLD_STEP = 0.1;

export const QUIET_MS = 100;

export const LEAD_MAX = 1;

const PRESS_FIELDS = [3, 4, 5, 7, 8, 9];
const samePresses = (a: readonly number[], b: readonly number[] | null): boolean => b !== null && PRESS_FIELDS.every((i) => a[i] === b[i]);

const STALE_TICKS = 50;

const MAX_LATENCY_MS = 1000;

const SNAP_KEEP = 25;

const FLUSH_MS = 200;

export type InputTimingMsg = { intendedTick: number; timeLeft: number };

export function marginFromEnv(raw: string | undefined): number {
  const text = raw?.trim() ?? "";
  if (!/^\d{1,3}$/.test(text)) return MARGIN_MS;
  const ms = Number(text);
  return ms <= MARGIN_MAX_MS ? ms : MARGIN_MS;
}

const VARINT_MASKS = [0x7f, 0x7f, 0x7f, 0x0f];

export function readVarInt(buf: Uint8Array, at: number): { value: number; next: number } | null {
  if (at < 0 || at >= buf.length) return null;
  const sign = (buf[at] >> 6) & 1;
  let value = buf[at] & 0x3f;
  let i = at;
  let shift = 6;
  for (const mask of VARINT_MASKS) {
    if ((buf[i] & 0x80) === 0) break;
    i++;
    if (i >= buf.length) return null;
    value |= (buf[i] & mask) << shift;
    shift += 7;
  }
  value ^= -sign;
  return { value, next: i + 1 };
}

export function decodeInputTiming(raw: Uint8Array): InputTimingMsg | null {
  const tick = readVarInt(raw, 0);
  if (tick === null) return null;
  const left = readVarInt(raw, tick.next);
  if (left === null) return null;
  return { intendedTick: tick.value, timeLeft: left.value };
}

let decodePatched = false;

export function patchInputTimingDecode(): boolean {
  if (decodePatched) return true;
  try {
    const require = createRequire(import.meta.url);
    const mod = require("teeworlds/lib/client.js") as { Client?: { prototype: Record<string, unknown> } };
    const proto = mod.Client?.prototype;
    const unpack = proto?.Unpack;
    if (proto === undefined || typeof unpack !== "function") return false;
    proto.Unpack = function withInputTiming(this: { emit: (e: string, ...a: unknown[]) => boolean }, packet: Buffer) {
      const out = (unpack as (p: Buffer) => { chunks?: { sys?: boolean; msgid?: number; raw?: Buffer }[] }).call(this, packet);
      for (const c of out?.chunks ?? []) {
        if (c.sys !== true || c.msgid !== NETMSG_INPUTTIMING || c.raw === undefined) continue;
        const m = decodeInputTiming(c.raw);
        if (m === null) continue;

        try {
          this.emit("input_timing", m);
        } catch {

        }
      }
      return out;
    };
    decodePatched = true;
    return true;
  } catch {
    return false;
  }
}

export type Stamp = { tick: number; reach: number; hold: number; snap: number | null };
export type TimingVerdict = "early" | "late" | "spike" | "unknown";

export class InputClock {

  offset: number | null = null;

  answered = false;
  private lastStamp = -1;
  private readonly sentAt = new Map<number, number>();
  private spikes = 0;
  private readonly needs: number[] = [];
  private lastSnapTick = -1;

  private readonly fromSnaps: number[] = [];

  resets = 0;

  snapStep = 0;
  readonly marginMs: number;

  readonly holding: boolean;

  constructor(marginMs = MARGIN_MS, holding = false) {
    this.marginMs = marginMs;
    this.holding = holding;
  }

  reset(): void {
    this.offset = null;
    this.answered = false;
    this.lastStamp = -1;
    this.sentAt.clear();
    this.spikes = 0;
    this.needs.length = 0;
    this.lastSnapTick = -1;
    this.fromSnaps.length = 0;
    this.snapStep = 0;
  }

  onSnapshot(tick: number, at: number): void {
    if (tick < this.lastSnapTick) this.reset();
    if (this.lastSnapTick >= 0 && tick > this.lastSnapTick) this.snapStep = tick - this.lastSnapTick;
    this.lastSnapTick = tick;
    this.fromSnaps.push(at - tick * TICK_MS);
    if (this.fromSnaps.length > SNAP_KEEP) this.fromSnaps.shift();
    if (!this.answered) this.offset = at - tick * TICK_MS;
    else this.sane();
  }

  private sane(): void {
    if (this.offset === null || this.fromSnaps.length === 0) return;
    const fromSnap = Math.min(...this.fromSnaps);
    if (fromSnap - this.offset <= MAX_LATENCY_MS) return;
    this.offset = fromSnap;
    this.answered = false;
    this.resets++;
  }

  lead(at: number, snapTick: number | null = null): number {
    if (this.offset === null) return 0;
    const b = this.base(at, snapTick);
    if (this.lastStamp > b.reach + STALE_TICKS) return 0;
    return Math.max(0, this.lastStamp + 1 - b.tick);
  }

  private base(at: number, snapTick: number | null): { reach: number; snap: number | null; need: number; hold: number; tick: number } {
    const reach = this.reach(at);

    const snap = snapTick !== null && snapTick < this.lastSnapTick && this.lastSnapTick - snapTick <= STALE_TICKS ? this.lastSnapTick : snapTick;
    const need = snap === null ? -1 : reach - snap - 1;
    if (need < 0 || need > STALE_TICKS) return { reach, snap, need, hold: 0, tick: reach };
    const hold = this.holding ? this.holdLag() : 0;
    return { reach, snap, need, hold, tick: Math.max(reach, (snap as number) + 1 + hold) };
  }

  reach(at: number): number {
    return Math.ceil((at + this.marginMs - (this.offset ?? at)) / TICK_MS);
  }

  holdLag(): number {
    if (this.needs.length < HOLD_MIN) return 0;
    const sorted = [...this.needs].sort((a, b) => a - b);
    const at = (q: number): number => sorted[Math.floor(q * (sorted.length - 1))];
    const share = (h: number): number => sorted.filter((x) => x === h).length / sorted.length;
    const top = at(HOLD_QUANTILE);
    let hold = at(0.5);
    while (hold < top && share(hold + 1) >= HOLD_STEP) hold++;
    return Math.max(0, hold);
  }

  stamp(at: number, snapTick: number | null = null): Stamp | null {
    if (this.offset === null) return null;
    const { reach, snap, need, hold, tick: base } = this.base(at, snapTick);
    if (this.lastStamp > reach + STALE_TICKS) this.lastStamp = -1;
    const tick = Math.max(base, this.lastStamp + 1);
    if (need >= 0 && need <= STALE_TICKS) {
      this.needs.push(need);
      if (this.needs.length > HOLD_KEEP) this.needs.shift();
    }
    this.lastStamp = tick;
    this.sentAt.set(tick, at);
    if (this.sentAt.size > SENT_KEEP) this.sentAt.delete(this.sentAt.keys().next().value as number);
    return { tick, reach, hold, snap };
  }

  onTiming(tick: number, timeLeft: number): TimingVerdict {
    const at = this.sentAt.get(tick);
    if (at === undefined || this.offset === null) return "unknown";

    const sample = timeLeft + at - tick * TICK_MS;
    if (timeLeft < 0) {

      const spike = this.answered && timeLeft < SPIKE_MS;
      if (spike) this.spikes = Math.min(SPIKE_CAP, this.spikes + SPIKE_STEP);
      if (spike && this.spikes < SPIKE_BELIEVED) return "spike";
      this.offset = sample;
      this.answered = true;
      this.sane();
      return "late";
    }
    if (this.spikes > 0) this.spikes--;

    const jump = !this.answered || sample - this.offset > TICK_MS;
    this.offset = jump ? sample : this.offset + (sample - this.offset) * UP_RATE;
    this.answered = true;
    return "early";
  }
}

export type WireInput = {
  m_Direction: number;
  m_TargetX: number;
  m_TargetY: number;
  m_Jump: number;
  m_Fire: number;
  m_Hook: number;
  m_PlayerFlags: number;
  m_WantedWeapon: number;
  m_NextWeapon: number;
  m_PrevWeapon: number;
};

const wireInts = (i: WireInput): number[] => [i.m_Direction, i.m_TargetX, i.m_TargetY, i.m_Jump, i.m_Fire, i.m_Hook, i.m_PlayerFlags, i.m_WantedWeapon, i.m_NextWeapon, i.m_PrevWeapon];

type OwnCharacter = { character_core?: { angle?: number; direction?: number } };

type OwnDDNetCharacter = { m_TargetX?: number | null; m_TargetY?: number | null };

export type TimingClient = {
  readonly State: number;
  PredGameTick: number;
  readonly AckGameTick: number;
  readonly currentSnapshotGameTick?: number;
  readonly movement: { readonly input: WireInput };
  sendInput(input?: WireInput): void;

  OnEnterGame?: () => void;
  readonly SnapshotUnpacker?: {
    readonly OwnID?: number;
    getObjCharacter?(id: number): OwnCharacter | undefined;
    getObjExDDNetCharacter?(id: number): OwnDDNetCharacter | undefined;
  };
  on(event: string, listener: (arg: unknown) => void): unknown;
};

let logsOpened = 0;

class TimingLog {

  readonly tag = `${process.pid}.${threadId}.${++logsOpened}`;
  private readonly fd: number;
  private lines: string[] = [];
  private readonly timer: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(path: string, head: Record<string, unknown>) {
    this.fd = openSync(path, "a");
    this.timer = setInterval(() => this.flush(), FLUSH_MS);
    this.timer.unref();
    this.write({ e: "start", ...head });
  }

  write(o: Record<string, unknown>): void {

    if (this.closed) return;
    this.lines.push(JSON.stringify({ c: this.tag, ...o }));
  }

  flush(): void {
    if (this.closed || this.lines.length === 0) return;
    const text = `${this.lines.join("\n")}\n`;
    this.lines = [];
    try {
      writeSync(this.fd, text);
    } catch {

    }
  }

  close(): void {
    if (this.closed) return;
    clearInterval(this.timer);
    this.flush();
    this.closed = true;
    try {
      closeSync(this.fd);
    } catch {

    }
  }
}

export type InputTimingOptions = {

  on: boolean;

  logPath?: string;
  marginMs?: number;

  hold?: boolean;

  stamp?: boolean;

  now?: () => number;

  onFail?: (err: unknown) => void;
};

export type InputTimingStats = { decisions: number; background: number; quiet: number; unstamped: number; answers: number; late: number; spikes: number };

export class InputTiming {
  readonly clock: InputClock;
  readonly stats: InputTimingStats = { decisions: 0, background: 0, quiet: 0, unstamped: 0, answers: 0, late: 0, spikes: 0 };
  private readonly original: (input?: WireInput) => void;
  private readonly now: () => number;
  private readonly log: TimingLog | null;

  readonly logError: string | null = null;

  private enabled: boolean;
  private readonly client: TimingClient;
  private readonly opts: InputTimingOptions;

  private decisionTick: number | null = null;
  private lastSentAt = Number.NEGATIVE_INFINITY;

  failures = 0;

  throttled = 0;

  private lastSentInts: number[] | null = null;

  constructor(client: TimingClient, opts: InputTimingOptions) {
    this.client = client;
    this.opts = opts;
    this.enabled = opts.on;
    this.clock = new InputClock(opts.marginMs ?? MARGIN_MS, opts.hold === true);
    this.now = opts.now ?? (() => performance.now());
    let log: TimingLog | null = null;
    if (opts.logPath !== undefined && opts.logPath !== "") {
      try {
        log = new TimingLog(opts.logPath, { on: opts.on, margin: this.clock.marginMs, hold: this.clock.holding, stamp: opts.stamp !== false, at: this.now(), wall: Date.now() });
      } catch (err) {

        this.logError = err instanceof Error ? err.message : String(err);
      }
    }
    this.log = log;
    this.original = client.sendInput;

    client.sendInput = (input?: WireInput) => this.send(input);

    const enter = client.OnEnterGame;
    if (typeof enter === "function") {
      client.OnEnterGame = () => {
        enter.call(client);
        this.guard(() => {
          this.clock.reset();
          this.log?.write({ e: "enter", at: this.now() });
        });
      };
    }

    client.on("input_timing", (m) => this.guard(() => this.onTiming(m as InputTimingMsg)));
    client.on("snapshot", () => this.guard(() => this.onSnapshot()));
    client.on("connected", () => this.guard(() => this.clock.reset()));
  }

  private guard(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.fail(err);
    }
  }

  private fail(err: unknown): void {
    this.failures++;
    if (!this.enabled) return;
    this.enabled = false;
    try {
      this.opts.onFail?.(err);
    } catch {

    }
  }

  get on(): boolean {
    return this.enabled;
  }

  setOn(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) this.clock.reset();
    this.log?.write({ e: "switch", at: this.now(), on });
  }

  sendDecision(snapTick: number): void {
    this.decisionTick = snapTick;
    try {
      this.client.sendInput();
    } finally {
      this.decisionTick = null;
    }
  }

  close(): void {
    this.log?.close();
  }

  summary(): string {
    const s = this.stats;
    return (
      `input timing: ${s.decisions} decisions and ${s.background} other inputs stamped, ${s.quiet} of the library's timer held back, ` +
      `${s.unstamped} sent its way; ${s.answers} answers, ${s.late} late, ${s.spikes} spikes; ${this.clock.resets} clock restarts${this.clock.holding ? `; holding ${this.clock.holdLag()} ticks` : ""}` +
      (this.throttled > 0 ? `; ${this.throttled} not sent behind a queue of ours` : "") +
      (this.failures > 0 ? `; ${this.failures} failures caught${this.enabled ? "" : ", the library's way since"}` : "")
    );
  }

  private send(input?: WireInput): void {
    const c = this.client;
    let calls = 0;
    let done = 0;
    const lib = (): void => {
      calls++;
      this.original.call(c, input);
      done++;
    };
    try {
      this.timedSend(input, lib);
    } catch (err) {
      if (calls > done) throw err;
      this.fail(err);
      if (calls === 0) this.original.call(c, input);
    }
  }

  private timedSend(input: WireInput | undefined, lib: () => void): void {
    const c = this.client;

    if (c.State !== STATE_ONLINE) return lib();
    const at = this.now();
    const snap = this.decisionTick;
    if (!this.enabled) {
      lib();
      this.log?.write({ e: "send", at, tick: c.PredGameTick, ack: c.AckGameTick, src: snap === null ? "lib" : "dec", snap, in: wireInts(input ?? c.movement.input) });
      return;
    }
    if (snap === null && at - this.lastSentAt < QUIET_MS) {
      this.stats.quiet++;
      return;
    }
    if (this.opts.stamp === false) {

      this.lastSentAt = at;
      if (snap === null) this.stats.background++;
      else this.stats.decisions++;
      lib();
      this.log?.write({ e: "send", at, tick: c.PredGameTick, ack: c.AckGameTick, src: snap === null ? "bg" : "dec", snap, in: wireInts(input ?? c.movement.input) });
      return;
    }
    const ints = wireInts(input ?? c.movement.input);
    if (this.clock.snapStep === 1 && at - this.lastSentAt < 2 * TICK_MS && samePresses(ints, this.lastSentInts)) {
      const lead = this.clock.lead(at, snap);
      if (lead > LEAD_MAX) {
        this.throttled++;
        this.log?.write({ e: "held", at, snap, lead });
        return;
      }
    }
    const s = this.clock.stamp(at, snap);
    this.lastSentAt = at;
    if (s === null) {

      this.stats.unstamped++;
      lib();
      this.lastSentInts = ints;
      this.log?.write({ e: "send", at, tick: c.PredGameTick, ack: c.AckGameTick, src: "raw", snap, in: ints });
      return;
    }
    if (snap === null) this.stats.background++;
    else this.stats.decisions++;

    const keep = c.PredGameTick;
    c.PredGameTick = s.tick;
    try {
      lib();
    } finally {
      c.PredGameTick = keep;
    }
    this.lastSentInts = ints;
    this.log?.write({ e: "send", at, tick: s.tick, ack: c.AckGameTick, src: snap === null ? "bg" : "dec", snap: s.snap, reach: s.reach, hold: s.hold, in: ints });
  }

  private onTiming(m: InputTimingMsg): void {
    const at = this.now();
    this.stats.answers++;
    if (this.enabled) {
      const v = this.clock.onTiming(m.intendedTick, m.timeLeft);
      if (v === "late") this.stats.late++;
      else if (v === "spike") this.stats.spikes++;
    }
    this.log?.write({ e: "timing", at, tick: m.intendedTick, left: m.timeLeft });
  }

  private onSnapshot(): void {
    const tick = this.client.currentSnapshotGameTick;
    if (typeof tick !== "number") return;
    const at = this.now();
    this.clock.onSnapshot(tick, at);
    if (this.log !== null) this.log.write({ e: "snap", at, tick, ...this.ownAim() });
  }

  private ownAim(): { ang?: number; dir?: number; tx?: number; ty?: number } {
    const out: { ang?: number; dir?: number; tx?: number; ty?: number } = {};
    try {
      const snap = this.client.SnapshotUnpacker;
      const id = snap?.OwnID;
      if (snap === undefined || typeof id !== "number") return out;
      const core = snap.getObjCharacter?.(id)?.character_core;
      if (typeof core?.angle === "number") {
        out.ang = core.angle;
        out.dir = core.direction;
      }
      const ex = snap.getObjExDDNetCharacter?.(id);
      if (typeof ex?.m_TargetX === "number" && typeof ex.m_TargetY === "number") {
        out.tx = ex.m_TargetX;
        out.ty = ex.m_TargetY;
      }
    } catch {

    }
    return out;
  }
}

export function installInputTiming(client: TimingClient, opts: InputTimingOptions): InputTiming | null {
  if (!opts.on && (opts.logPath === undefined || opts.logPath === "")) return null;
  if (!patchInputTimingDecode()) return null;
  return new InputTiming(client, opts);
}
