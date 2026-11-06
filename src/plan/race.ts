import type { Collision } from "../core/collision.ts";
import type { Vec2 } from "../core/vmath.ts";
import type { PlayerInput, TeeState } from "../core/types.ts";
import { emptyInput } from "../core/types.ts";
import { PHYSICAL_SIZE, TILE_TELEIN, TILE_TELEINEVIL } from "../core/tuning.ts";
import { findRouteGen, prepareRouteGen } from "./route.ts";
import type { RouteStep } from "./route.ts";
import { DEFAULT_SEARCH, PathWalker, fieldOfGen, prepareTablesGen } from "./pathfind.ts";
import { KILL_COOLDOWN_TICKS } from "../bot/killFallback.ts";
import type { PathGoal, PathSearchOpts, SegmentOpts, TileBox } from "./pathfind.ts";

export const TILE_START = 33;
export const TILE_FINISH = 34;
export const TILE_TIME_CP_FIRST = 35;
export const TILE_TIME_CP_LAST = 59;
const TILE = 32;

export type RaceLines = {

  start: Int32Array;
  finish: Int32Array;

  startBoxes: TileBox[];
  finishBoxes: TileBox[];

  timeCps: number;
};

export function raceTileAt(col: Collision, index: number, tile: number): boolean {
  if (index < 0 || index >= col.tiles.length) return false;
  return col.tiles[index] === tile || (col.frontIndex !== undefined && col.frontIndex[index] === tile);
}

export function lineBoxes(width: number, cells: Int32Array): TileBox[] {
  const sorted = Array.from(cells).sort((a, b) => (a % width) - (b % width) || a - b);
  const runs: TileBox[] = [];
  for (let k = 0; k < sorted.length; ) {
    const x = sorted[k] % width;
    const y0 = Math.trunc(sorted[k] / width);
    let y1 = y0;
    k++;
    while (k < sorted.length && sorted[k] % width === x && Math.trunc(sorted[k] / width) === y1 + 1) {
      y1++;
      k++;
    }
    runs.push({ x0: x, y0, x1: x, y1 });
  }
  const out: TileBox[] = [];
  for (const r of runs) {
    const prev = out.find((b) => b.x1 === r.x0 - 1 && b.y0 === r.y0 && b.y1 === r.y1);
    if (prev !== undefined) prev.x1 = r.x0;
    else out.push({ ...r });
  }
  return out;
}

const linesCache = new WeakMap<Collision, { revision: number; lines: RaceLines }>();

export function raceLines(col: Collision): RaceLines {
  const hit = linesCache.get(col);
  if (hit !== undefined && hit.revision === col.revision) return hit.lines;
  const start: number[] = [];
  const finish: number[] = [];
  let timeCps = 0;

  const game = col.tiles;
  const front = col.frontIndex;
  for (let i = 0; i < game.length; i++) {
    const t = game[i];
    const f = front === undefined ? 0 : front[i];
    if ((t < TILE_START || t > TILE_TIME_CP_LAST) && (f < TILE_START || f > TILE_TIME_CP_LAST)) continue;
    if (t === TILE_START || f === TILE_START) start.push(i);
    if (t === TILE_FINISH || f === TILE_FINISH) finish.push(i);
    if ((t >= TILE_TIME_CP_FIRST && t <= TILE_TIME_CP_LAST) || (f >= TILE_TIME_CP_FIRST && f <= TILE_TIME_CP_LAST)) timeCps++;
  }
  const s = Int32Array.from(start);
  const f = Int32Array.from(finish);
  const lines: RaceLines = { start: s, finish: f, startBoxes: lineBoxes(col.width, s), finishBoxes: lineBoxes(col.width, f), timeCps };
  linesCache.set(col, { revision: col.revision, lines });
  return lines;
}

export function isRaceMap(col: Collision): boolean {
  return raceLines(col).finish.length > 0;
}

export function raceMapLikely(col: Collision, hasWb: boolean): boolean {
  if (hasWb) return false;
  const l = raceLines(col);
  return l.finish.length > 0 && l.start.length > 0;
}

export type RaceHit = { start: boolean; finish: boolean };

const PROBE = PHYSICAL_SIZE / 3;
const scanBuf: number[] = [];

export function raceHit(col: Collision, prev: Vec2, pos: Vec2): RaceHit {
  const out: RaceHit = { start: false, finish: false };
  const cells = col.getMapIndices(prev, pos, scanBuf);
  if (cells.length === 0) {
    const here = col.getMapIndex(pos);
    if (here >= 0) cells.push(here);
  }
  if (cells.length === 0) return out;
  for (const i of cells) {
    if (raceTileAt(col, i, TILE_START)) out.start = true;
    if (raceTileAt(col, i, TILE_FINISH)) out.finish = true;
  }
  for (const [dx, dy] of [
    [PROBE, -PROBE],
    [PROBE, PROBE],
    [-PROBE, -PROBE],
    [-PROBE, PROBE],
  ]) {
    const x = pos.x + dx;
    const y = pos.y + dy;
    const t = col.getTileIndex(x, y);
    const f = col.getFrontTileIndex(x, y);
    if (t === TILE_START || f === TILE_START) out.start = true;
    if (t === TILE_FINISH || f === TILE_FINISH) out.finish = true;
  }
  return out;
}

export class RaceClock {
  state: "none" | "started" | "finished" = "none";
  startTick = -1;

  time = -1;

  observe(col: Collision, prev: Vec2, pos: Vec2, tick: number): "start" | "finish" | null {
    const h = raceHit(col, prev, pos);
    let what: "start" | "finish" | null = null;
    if (h.start) {
      this.state = "started";
      this.startTick = tick;
      this.time = -1;
      what = "start";
    }
    if (h.finish && this.state === "started" && tick - this.startTick > 0) {
      this.state = "finished";
      this.time = tick - this.startTick;
      what = "finish";
    }
    return what;
  }

  reset(): void {
    this.state = "none";
    this.startTick = -1;
    this.time = -1;
  }
}

export type RaceDriverOpts = {

  legTiles: number;

  frozenKillTicks: number;
  restKillTicks: number;

  deepKillTicks: number;

  stallKillTicks: number;

  maxLegFails: number;

  killCooldownTicks: number;

  legMaxTicks: number;

  repeatAfterTicks: number;

  maxLivesWithoutGain: number;

  pumpMs: number;
  pumpYields: number;

  now?: () => number;
  search?: Partial<PathSearchOpts>;
  segment?: Partial<SegmentOpts>;

  clock?: () => number;

  trace?: (msg: string) => void;
};

export const RACE_DEFAULTS: RaceDriverOpts = {
  legTiles: 32,
  frozenKillTicks: 200,
  restKillTicks: 25,
  deepKillTicks: 25,

  stallKillTicks: 1000,
  maxLegFails: 3,
  killCooldownTicks: KILL_COOLDOWN_TICKS,

  legMaxTicks: 600,
  repeatAfterTicks: 150,
  maxLivesWithoutGain: 3,
  pumpMs: 4,
  pumpYields: Infinity,

  segment: { onward: false, planWork: 3_000_000, thinNodes: 40_000, planMs: 20_000, sliceMs: 8 },
};

const STALL_GAIN = 8;

export const JUMP_PX = 160;

export const RESUME_GAP_TICKS = 50;
export const DROP_GAP_TICKS = 250;

export const HOLD_AFTER_ARRIVAL_TICKS = 10;

const ROUTE_NODES = 200_000;
const ROUTE_MAX_COST = 20_000;

const NOT_STARTED = 1e6;

export type RaceStep = { input: PlayerInput; kill: boolean };

export type RacePhase = "start" | "finish" | "done";

type Job<T> = Generator<void, T, void>;

type LegPlan = { goal: PathGoal; to: { tx: number; ty: number } | null; start: { tx: number; ty: number }; walker: PathWalker; tele: boolean };

type Budget = { until: number; yields: number };

export class RaceDriver {
  readonly col: Collision;
  readonly lines: RaceLines;
  readonly o: RaceDriverOpts;
  readonly clock = new RaceClock();
  private readonly now: () => number;
  private walker: PathWalker | null = null;

  private fieldsJob: Job<void> | null = null;
  private legJob: Job<LegPlan | null> | null = null;
  private ahead: { from: { tx: number; ty: number }; job: Job<LegPlan | null> | null; plan: LegPlan | null } | null = null;

  private legGoal: PathGoal | null = null;
  private legTo: { tx: number; ty: number } | null = null;
  private legTele = false;
  private legFails = 0;
  private legStart: { tx: number; ty: number } | null = null;

  private lastWalkInput: PlayerInput = emptyInput();
  private arrivedAt = -1;

  private readonly failedAt = new Map<number, number>();
  private failedThisLife = false;
  private lastPos: Vec2 | null = null;
  private wasAlive = false;
  private lastStep = -1;
  private frozenSince = -1;
  private restSince = -1;
  private deepSince = -1;
  private best = Infinity;

  private bestTick = -1;

  private lifeBest = Infinity;
  private lived = false;
  private finishedThisLife = false;
  private bestEver = Infinity;
  private livesWithoutGain = 0;
  private gaveUpValue = false;
  private lastKill = -1_000_000;
  private killAsked = -1;
  private finishedAt = -1;
  private finishField: Float64Array | null = null;
  private startField: Float64Array | null = null;
  private readonly notes: string[] = [];
  private readonly idle = emptyInput();

  legs = 0;
  legsAhead = 0;
  legFailsTotal = 0;
  kills = 0;
  killWhy: string[] = [];

  waits = 0;

  maxPumpMs = 0;

  constructor(col: Collision, opts: Partial<RaceDriverOpts> = {}) {
    this.col = col;
    this.lines = raceLines(col);
    this.o = { ...RACE_DEFAULTS, ...opts, segment: { ...RACE_DEFAULTS.segment, ...opts.segment } };
    this.now = opts.now ?? (() => performance.now());
  }

  get phase(): RacePhase {
    if (this.clock.state === "finished") return "done";
    return this.clock.state === "started" || this.lines.start.length === 0 ? "finish" : "start";
  }

  get gaveUp(): boolean {
    return this.gaveUpValue;
  }

  get planning(): boolean {
    return this.fieldsJob !== null || (this.walker === null && (this.legJob !== null || this.ahead !== null));
  }

  prepare(): void {
    if (this.fieldsReady()) return;
    const g = this.makeFieldsJob();
    for (;;) if (g.next().done === true) break;
  }

  fieldTo(phase: RacePhase, x: number, y: number): number {
    const f = phase === "start" && this.lines.start.length > 0 ? this.startField : this.finishField;
    if (f === null) return Infinity;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= this.col.width || ty >= this.col.height) return Infinity;
    return f[ty * this.col.width + tx];
  }

  takeNotes(): string[] {
    return this.notes.splice(0, this.notes.length);
  }

  doing(self: TeeState | null): string {
    const at = self === null ? "" : ` at (${Math.trunc(self.pos.x / TILE)},${Math.trunc(self.pos.y / TILE)})`;
    if (this.phase === "done") return `finished in ${(this.clock.time / 50).toFixed(2)} s`;
    if (this.gaveUpValue) return `racing${at}: no way found, standing`;
    if (this.fieldsJob !== null) return `racing${at}: planning the map`;
    if (this.walker === null && (this.legJob !== null || this.ahead !== null)) return `racing${at}: planning the next leg to the ${this.phase} line`;
    const to = this.legTo === null ? `the ${this.phase} line` : `(${this.legTo.tx},${this.legTo.ty}) on the way to the ${this.phase} line`;
    return `racing${at}: leg ${this.legs} to ${to}`;
  }

  private lineGoal(boxes: TileBox[]): PathGoal {
    return { zone: boxes, spots: [], stop: false, enter: true, thaw: true };
  }

  private note(s: string): void {
    this.notes.push(s);
    if (this.notes.length > 50) this.notes.shift();
  }

  noteKill(tick: number): void {
    if (tick > this.lastKill) this.lastKill = tick;
  }

  respawned(): void {
    if (this.lived) {
      const gained = this.finishedThisLife || (Number.isFinite(this.lifeBest) && this.lifeBest < this.bestEver - STALL_GAIN);
      if (Number.isFinite(this.lifeBest) && this.lifeBest < this.bestEver) this.bestEver = this.lifeBest;
      this.livesWithoutGain = gained ? 0 : this.livesWithoutGain + 1;
      if (!this.gaveUpValue && this.livesWithoutGain >= this.o.maxLivesWithoutGain) {
        this.gaveUpValue = true;
        this.note(`no way found: ${this.livesWithoutGain} runs in a row got no further, standing`);
      }
    }
    this.lived = false;
    this.lifeBest = Infinity;
    this.finishedThisLife = false;
    this.failedThisLife = false;
    this.clock.reset();
    this.dropLeg();
    this.lastPos = null;
    this.resetKillTimers(-1);
  }

  private resetKillTimers(tick: number): void {
    this.frozenSince = -1;
    this.restSince = -1;
    this.deepSince = -1;
    this.best = Infinity;
    this.bestTick = tick;
    this.killAsked = -1;
  }

  resume(tick: number): void {
    this.resetKillTimers(tick);
    this.dropLeg();
    this.lastPos = null;
  }

  private dropLeg(): void {
    this.walker = null;
    this.legJob = null;
    this.ahead = null;
    this.legGoal = null;
    this.legTo = null;
    this.legTele = false;
    this.legFails = 0;
    this.arrivedAt = -1;
  }

  step(self: TeeState, tick: number, lag: number): RaceStep {
    if (this.lastStep >= 0) {
      const gap = tick - this.lastStep;
      if (gap > DROP_GAP_TICKS) this.resume(tick);
      else if (gap > RESUME_GAP_TICKS) this.resetKillTimers(tick);
    }
    this.lastStep = tick;
    if (!self.alive) {
      this.wasAlive = false;
      return { input: this.idle, kill: false };
    }
    if (!this.wasAlive) {
      this.wasAlive = true;
      this.respawned();
    }
    this.lived = true;
    const budget: Budget = { until: this.o.pumpMs === Infinity ? Infinity : this.now() + this.o.pumpMs, yields: this.o.pumpYields };

    const prev = this.lastPos;
    const jumped = prev !== null && Math.hypot(self.pos.x - prev.x, self.pos.y - prev.y) > JUMP_PX;
    const phaseBefore = this.phase;
    const seen = this.clock.observe(this.col, prev === null || jumped ? self.pos : prev, self.pos, tick);
    this.lastPos = { x: self.pos.x, y: self.pos.y };
    if (seen === "finish") {
      this.note(`finished in ${(this.clock.time / 50).toFixed(2)} s`);
      this.finishedAt = tick;
      this.finishedThisLife = true;
    }

    if (jumped && (this.walker !== null || this.legJob !== null || this.ahead !== null)) {
      this.note(`moved ${Math.round(Math.hypot(self.pos.x - (prev?.x ?? 0), self.pos.y - (prev?.y ?? 0)))} px at once (a teleporter): planning the leg again`);
      this.dropLeg();
    }
    if (this.phase !== phaseBefore) {

      if (seen === "start") this.note(`started the run at (${Math.trunc(self.pos.x / TILE)},${Math.trunc(self.pos.y / TILE)})`);
      this.dropLeg();
      this.best = Infinity;
      this.bestTick = tick;
    }
    if (this.phase === "done") {
      const again = this.o.repeatAfterTicks > 0 && this.finishedAt >= 0 && tick - this.finishedAt >= this.o.repeatAfterTicks && tick - this.lastKill >= this.o.killCooldownTicks;
      if (again) {
        this.lastKill = tick;

        this.finishedAt = tick;
        this.note("/kill: the run is over, running it again");
      }
      return { input: this.idle, kill: again };
    }
    if (this.gaveUpValue) return { input: this.idle, kill: false };

    if (this.killAsked >= 0 && tick - this.killAsked < this.o.killCooldownTicks) return { input: this.idle, kill: false };
    this.killAsked = -1;

    const k = this.killReason(self, tick);
    if (k !== null && tick - this.lastKill >= this.o.killCooldownTicks) {
      this.lastKill = tick;
      this.killAsked = tick;
      this.kills++;
      this.killWhy.push(k.why);
      if (!this.failedThisLife) {
        this.failedThisLife = true;
        this.noteFailure(k.at);
      }
      this.note(`/kill: ${k.why}`);
      return { input: this.idle, kill: true };
    }

    const t0 = this.now();
    try {

      if (this.fieldsJob !== null || !this.fieldsReady()) {
        this.fieldsJob ??= this.makeFieldsJob();
        const r = this.pump(this.fieldsJob, budget);
        if (r === null) {
          this.waits++;
          return { input: this.idle, kill: false };
        }
        this.fieldsJob = null;
      }
      let input = this.walk(self, tick, lag, budget);
      if (this.gaveUpValue) return { input: this.idle, kill: false };

      this.planAhead(budget);

      if (input.fire !== 0 || (self.hookedPlayer >= 0 && input.hook !== 0)) {
        input = { ...input, fire: 0, hook: self.hookedPlayer >= 0 ? 0 : input.hook };
      }
      return { input, kill: false };
    } finally {
      const took = this.now() - t0;
      if (took > this.maxPumpMs) this.maxPumpMs = took;
    }
  }

  private fieldsReady(): boolean {
    return this.finishField !== null && (this.lines.start.length === 0 || this.startField !== null);
  }

  private *makeFieldsJob(): Job<void> {
    if (this.finishField === null) this.finishField = yield* fieldOfGen(this.col, this.lineGoal(this.lines.finishBoxes), 12);
    if (this.lines.start.length > 0 && this.startField === null) this.startField = yield* fieldOfGen(this.col, this.lineGoal(this.lines.startBoxes), 12);

    yield* prepareTablesGen(this.col);
    yield* prepareRouteGen(this.col);
  }

  private pump<T>(job: Job<T>, budget: Budget): { value: T } | null {
    try {
      for (;;) {
        if (budget.yields <= 0 || (budget.until !== Infinity && this.now() >= budget.until)) return null;
        const r = job.next();
        if (r.done === true) return { value: r.value };
        budget.yields--;
      }
    } catch (e) {
      this.fieldsJob = null;
      this.legJob = null;
      this.ahead = null;
      this.walker = null;
      this.gaveUpValue = true;
      this.note(`planning failed, standing: ${(e as Error).message ?? String(e)}`);
      return null;
    }
  }

  private killReason(self: TeeState, tick: number): { why: string; at: { tx: number; ty: number } } | null {
    const here = { tx: Math.trunc(self.pos.x / TILE), ty: Math.trunc(self.pos.y / TILE) };

    const at = this.legStart ?? here;

    const d = this.fieldTo(this.phase, self.pos.x, self.pos.y);
    if (this.bestTick < 0 || (this.phase === "finish" ? this.finishField : this.startField) === null) this.bestTick = tick;
    if (d < this.best - STALL_GAIN || (!Number.isFinite(this.best) && Number.isFinite(d))) {
      this.best = d;
      this.bestTick = tick;
    }
    if (Number.isFinite(d)) {
      const score = this.phase === "start" ? NOT_STARTED + d : d;
      if (score < this.lifeBest) this.lifeBest = score;
    }
    if (self.frozen) {
      if (this.frozenSince < 0) this.frozenSince = tick;
    } else this.frozenSince = -1;
    const onFreeze = this.col.isAnyFreeze(self.pos.x, self.pos.y);
    const atRest = Math.abs(self.vel.x) < 0.5 && Math.abs(self.vel.y) < 0.5;
    if (self.frozen && onFreeze && atRest) {
      if (this.restSince < 0) this.restSince = tick;
    } else this.restSince = -1;
    if (self.deepFrozen === true) {
      if (this.deepSince < 0) this.deepSince = tick;
    } else this.deepSince = -1;
    if (this.deepSince >= 0 && tick - this.deepSince >= this.o.deepKillTicks) return { why: "deep-frozen", at };
    if (this.restSince >= 0 && tick - this.restSince >= this.o.restKillTicks) return { why: `lying in the freeze at (${here.tx},${here.ty})`, at };
    if (this.frozenSince >= 0 && tick - this.frozenSince >= this.o.frozenKillTicks) return { why: `frozen for ${tick - this.frozenSince} ticks`, at };
    if (tick - this.bestTick >= this.o.stallKillTicks) return { why: `no progress for ${tick - this.bestTick} ticks at (${here.tx},${here.ty})`, at };
    if (this.legFails > this.o.maxLegFails) return { why: `${this.legFails} walks failed on leg ${this.legs}`, at };
    return null;
  }

  private walk(self: TeeState, tick: number, lag: number, budget: Budget): PlayerInput {
    for (let tries = 0; tries < 2; tries++) {
      if (this.walker === null) {
        const plan = this.nextPlan(self, budget);
        if (plan === undefined) {

          this.waits++;
          return this.arrivedAt >= 0 && tick - this.arrivedAt <= HOLD_AFTER_ARRIVAL_TICKS ? this.lastWalkInput : this.idle;
        }
        if (plan === null) return this.idle;
        this.install(plan);
      }
      const w = this.walker;
      if (w === null) return this.idle;
      const input = w.step(self, tick, lag);
      if (w.phase === "walking") {
        this.lastWalkInput = input;
        this.arrivedAt = -1;
        return input;
      }
      if (w.phase === "arrived") {

        this.legFails = 0;
        this.walker = null;
        this.arrivedAt = tick;
        if (this.legTo === null) return this.idle;
        continue;
      }

      this.legFails++;
      this.legFailsTotal++;
      this.note(`leg ${this.legs} failed (${w.reason})`);
      this.walker = null;
      this.ahead = null;
      this.arrivedAt = -1;
      if (this.legFails > this.o.maxLegFails) return this.idle;
    }
    return this.idle;
  }

  private nextPlan(self: TeeState, budget: Budget): LegPlan | null | undefined {
    const ahead = this.ahead;
    if (ahead !== null) {
      if (ahead.plan === null && ahead.job !== null) {
        const r = this.pump(ahead.job, budget);
        if (r === null) return undefined;
        ahead.plan = r.value;
        ahead.job = null;
      }
      this.ahead = null;
      if (ahead.plan !== null) {
        this.legsAhead++;
        return ahead.plan;
      }
    }
    this.legJob ??= this.makeLegJob({ x: self.pos.x, y: self.pos.y }, this.legFails);
    const r = this.pump(this.legJob, budget);
    if (r === null) return undefined;
    this.legJob = null;
    return r.value;
  }

  private install(plan: LegPlan): void {
    this.legs++;
    this.legStart = plan.start;
    this.legGoal = plan.goal;
    this.legTo = plan.to;
    this.legTele = plan.tele;
    this.walker = plan.walker;
  }

  private planAhead(budget: Budget): void {
    if (this.walker === null || this.legTo === null || this.legTele) return;
    if (this.ahead === null) {
      const from = this.legTo;
      this.ahead = { from, job: this.makeLegJob({ x: from.tx * TILE + TILE / 2, y: from.ty * TILE + TILE / 2 }, 0), plan: null };
    }
    const ahead = this.ahead;
    if (ahead.job === null) return;
    const r = this.pump(ahead.job, budget);
    if (r === null) return;

    if (this.ahead === ahead) {
      ahead.plan = r.value;
      ahead.job = null;
    }
  }

  private *makeLegJob(pos: Vec2, legFails: number): Job<LegPlan | null> {
    const boxes = this.phase === "start" ? this.lines.startBoxes : this.lines.finishBoxes;
    if (boxes.length === 0) return null;
    const here = { tx: Math.trunc(pos.x / TILE), ty: Math.trunc(pos.y / TILE) };

    const tries = this.failuresAt(here) + legFails;
    const shorter = Math.min(tries, 3);
    const span = this.o.legTiles > 0 ? Math.max(6, Math.round(this.o.legTiles / (1 << shorter))) : 0;
    let goal: PathGoal = this.lineGoal(boxes);
    let to: { tx: number; ty: number } | null = null;
    let tele = false;
    if (span > 0) {
      let route: { steps: RouteStep[]; cost: number } | null = null;
      if (tries % 2 === 0) {

        const cands = boxes
          .map((b) => ({ x: ((b.x0 + b.x1) / 2) * TILE + TILE / 2, y: Math.round((b.y0 + b.y1) / 2) * TILE + TILE / 2 }))
          .sort((a, b) => Math.hypot(a.x - pos.x, a.y - pos.y) - Math.hypot(b.x - pos.x, b.y - pos.y))
          .slice(0, 4);
        for (const c of cands) {
          const r = yield* findRouteGen(this.col, pos, c, { nearTiles: 1, maxCost: ROUTE_MAX_COST, maxNodes: ROUTE_NODES, partial: false, allowKill: false, throughFreeze: true });
          if (r !== null && (route === null || r.cost < route.cost)) route = r;
        }
      }
      const wp = route === null ? null : waypoint(route.steps, here, span);
      if (wp !== null) {
        to = wp.tile;
        tele = wp.tele;
        goal = wp.tele
          ? { zone: [{ x0: wp.tile.tx, y0: wp.tile.ty, x1: wp.tile.tx, y1: wp.tile.ty }], spots: [], stop: false, enter: true, thaw: true }
          : { zone: [{ x0: wp.tile.tx - 1, y0: wp.tile.ty - 1, x1: wp.tile.tx + 1, y1: wp.tile.ty + 1 }], spots: [wp.tile], stop: false, thaw: true };
      } else if (route === null) {

        const field = this.phase === "start" && this.startField !== null ? this.startField : this.finishField;
        const fw = field === null ? null : fieldWaypoint(field, this.col.width, this.col.height, here, span, (x, y) => this.col.isAnyFreeze(x * TILE + 16, y * TILE + 16));
        if (fw !== null) {
          to = fw;

          const tt = this.col.teleTypeAtIndex(fw.ty * this.col.width + fw.tx);
          tele = tt === TILE_TELEIN || tt === TILE_TELEINEVIL;
          goal = tele
            ? { zone: [{ x0: fw.tx, y0: fw.ty, x1: fw.tx, y1: fw.ty }], spots: [], stop: false, enter: true, thaw: true }
            : { zone: [{ x0: fw.tx - 1, y0: fw.ty - 1, x1: fw.tx + 1, y1: fw.ty + 1 }], spots: [fw], stop: false, thaw: true };
        }
        if (tries % 2 === 0) this.note(`no route to the ${this.phase} line from (${here.tx},${here.ty}); down the field instead${fw === null ? " (to the line)" : ` to (${fw.tx},${fw.ty})`}`);
      }
    }

    yield* fieldOfGen(this.col, goal, this.o.search?.v ?? DEFAULT_SEARCH.v);
    const walker = new PathWalker(this.col, goal, here, { search: this.o.search, segment: this.o.segment, clock: this.o.clock, library: null, maxTicks: this.o.legMaxTicks, ...(this.o.trace !== undefined ? { trace: this.o.trace } : {}) });
    return { goal, to, start: here, walker, tele };
  }

  private cellKey(t: { tx: number; ty: number }): number {
    return (t.ty >> 2) * 65536 + (t.tx >> 2);
  }

  private noteFailure(t: { tx: number; ty: number }): void {
    const k = this.cellKey(t);
    this.failedAt.set(k, (this.failedAt.get(k) ?? 0) + 1);
  }

  failuresAt(t: { tx: number; ty: number }): number {
    return this.failedAt.get(this.cellKey(t)) ?? 0;
  }

  get leg(): { goal: PathGoal | null; to: { tx: number; ty: number } | null; fails: number } {
    return { goal: this.legGoal, to: this.legTo, fails: this.legFails };
  }
}

export function fieldWaypoint(field: Float64Array, width: number, height: number, here: { tx: number; ty: number }, steps: number, skip?: (tx: number, ty: number) => boolean): { tx: number; ty: number } | null {
  let x = here.tx;
  let y = here.ty;
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  let v = field[y * width + x];
  if (!Number.isFinite(v)) return null;
  for (let i = 0, n = 0; i < steps && n < 4 * steps; n++) {
    let bx = -1;
    let by = -1;
    let bv = v;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const nx = x + ox;
        const ny = y + oy;
        if ((ox === 0 && oy === 0) || nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const nv = field[ny * width + nx];
        if (nv < bv) {
          bv = nv;
          bx = nx;
          by = ny;
        }
      }
    }
    if (bx < 0) break;
    x = bx;
    y = by;
    v = bv;
    if (v <= 0) return null;
    if (skip === undefined || !skip(x, y)) i++;
  }
  if (skip !== undefined && skip(x, y)) return null;
  return x === here.tx && y === here.ty ? null : { tx: x, ty: y };
}

export function waypoint(steps: readonly RouteStep[], here: { tx: number; ty: number }, span: number): { tile: { tx: number; ty: number }; tele: boolean } | null {
  let len = 0;
  let px = here.tx;
  let py = here.ty;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    len += Math.max(Math.abs(s.x - px), Math.abs(s.y - py));
    px = s.x;
    py = s.y;
    if (s.tele === true) return { tile: { tx: s.x, ty: s.y }, tele: true };

    if (len >= span && s.freeze !== true && i < steps.length - 1) return { tile: { tx: s.x, ty: s.y }, tele: false };
  }
  return null;
}
