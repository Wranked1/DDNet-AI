import { float32 } from "../core/float.ts";
import type { Collision } from "../core/collision.ts";
import type { CharacterCore } from "../core/characterCore.ts";
import { PHYSICAL_SIZE } from "../core/tuning.ts";
import type { PlayerInput, TeeState } from "../core/types.ts";
import { emptyInput } from "../core/types.ts";
import { FLAT_FREEZE_LEFT, FLAT_HOOK_STATE, FLAT_HOOK_X, FLAT_HOOK_Y, FLAT_POS_X, FLAT_POS_Y, FLAT_STRIDE, FLAT_VEL_X, FLAT_VEL_Y, SimWorld } from "../core/world.ts";
import { KILL_COOLDOWN_TICKS } from "../bot/killFallback.ts";
import { DEFAULT_SEARCH, MACRO_ROOT, PathSearcher, PathWalker, REJOIN_PX_MAX, TELEPORT_PX, fieldOfGen, grabPoints, trackDist } from "./pathfind.ts";
import type { PathGoal, PathSearchOpts, Route } from "./pathfind.ts";
import { DROP_GAP_TICKS, JUMP_PX, RESUME_GAP_TICKS, RaceClock, raceLines } from "./race.ts";
import type { RacePhase, RaceStep } from "./race.ts";
import type { Section } from "./goresCourse.ts";
import { stitch } from "./goresMap.ts";
import type { CourseSource, MapSolution, Stitched } from "./goresMap.ts";

const TILE = 32;
const S = FLAT_STRIDE;
const HALF = PHYSICAL_SIZE / 2;

const AIM_SLACK_PX = 2;

const SHIFT_COST = 5;

const GLOBAL_SPREAD = 1;

const APPROACH_MAX_TICKS = 600;
const MAX_APPROACH_FAILS = 2;

const PREFIX_END_TICKS = 3;
const PREFIX_REASK_TICKS = 100;

const MIN_REJOIN_WINDOW_TICKS = 3;
const REJOIN_LOOKBACK_TICKS = 2;
const REJOIN_IMPROVE_EXPANSIONS = 100;

const CORRIDOR_PAST_GATE_TICKS = 10;

const GOAL_JOIN_TICKS = 4;

const REJOIN_CLEARANCE_PX = 12;
const REJOIN_CLEARANCE_COST = 1;

const MIN_LIVE_AHEAD_TICKS = 8;

const MAX_LIVE_AHEAD_TICKS = 64;
const SETTLE_MAX_TICKS = 100;

const EXACT_REACH_PX = 480;
const EXACT_MAX_DECISIONS = 120;
const EXACT_MAX_NODES = 12_000;
const MAX_START_TRIES = 3;

const GIVE_UP_RETRY_TICKS = 1500;
const GIVE_UP_RETRY_MAX_TICKS = 30_000;

const EXACT_MAX_RUN = 40;
const EXACT_RUNS_TRIED = 6;
const EXACT_FINE_PX = 64;

const EXACT_FINE_SHARE = 0.5;

const REST_SPEED = 1 / 256;

const SHADOW_TICKS = 128;

const MAX_FAILED_SECTIONS = 200;

export type GoresDriverOpts = {

  tolOn: number;
  tolOff: number;

  alignWindow: number;
  holdWindow: number;

  horizon: number;
  holdTicks: number;

  aimThrows: boolean;

  driftDecisions: number;

  rejoinWindowTicks: number;
  rejoinNodes: number;
  rejoinExpansions: number;
  rejoinHoldoffTicks: number;

  rejoinPx: number;
  rejoinSpeed: number;

  corridorPx: number;

  pumpMs: number;
  pumpYields: number;

  frozenKillTicks: number;
  restKillTicks: number;
  deepKillTicks: number;

  stallTicks: number;
  stallGain: number;

  maxRejoinFails: number;
  maxSectionFails: number;

  repeatAfterTicks: number;

  killCooldownTicks: number;

  now?: () => number;
};

export const GORES_DRIVER_DEFAULTS: GoresDriverOpts = {
  tolOn: 8,
  tolOff: 120,
  alignWindow: 1,
  holdWindow: 6,
  horizon: 30,
  holdTicks: 40,
  aimThrows: false,
  driftDecisions: 3,
  rejoinWindowTicks: 120,
  rejoinNodes: 8000,
  rejoinExpansions: 2000,
  rejoinHoldoffTicks: 40,
  rejoinPx: 6,
  rejoinSpeed: 1,
  corridorPx: 192,
  pumpMs: 4,
  pumpYields: 0,
  frozenKillTicks: 200,
  restKillTicks: 25,
  deepKillTicks: 25,
  stallTicks: 400,
  stallGain: 20,
  maxRejoinFails: 3,
  maxSectionFails: 3,
  repeatAfterTicks: 150,
  killCooldownTicks: KILL_COOLDOWN_TICKS,
};

export type GoresStats = {

  attempts: number;
  finishes: number;

  bestTicks: number;
  lastTicks: number;

  failedSections: number[];

  rejoins: number;
  rejoinFails: number;

  kills: number;

  shifts: number;
  refound: number;
};

type Head = { inputs: PlayerInput[]; states: Float64Array; grabs: Float64Array | null };
type Play = { head: Head | null; headTicks: number; storedFrom: number };

type Align = { index: number; cost: number; d0: number; near: number };

type Job = {
  gen: Generator<void, Route | null, void>;
  base: number;
  hi: number;
  startTick: number;
  ahead: number;
  hold: PlayerInput | null;
  goalSection: number;
  endStored: number;
  decisions: number;
  done: { route: Route | null } | null;
};
type Bearing = "on" | "drift" | "off";

function routeOf(inputs: PlayerInput[], states: Float64Array): Route {
  return { ticks: inputs.length, codes: [], edgeTicks: [], inputs, states, expanded: 0, nodes: 0, ms: 0, simTicks: 0, freezes: 0 };
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function tapeProblem(sol: MapSolution | null, tape: Stitched): string | null {
  const n = tape.inputs.length;
  if (n < 1) return "the tape is empty";
  if (tape.states.length % S !== 0 || tape.states.length / S !== n + 1) return "the tape's states are not one more than its inputs";
  const st = tape.states;
  for (let i = 0; i <= n; i++) {
    const o = i * S;
    if (!Number.isFinite(st[o + FLAT_POS_X]) || !Number.isFinite(st[o + FLAT_POS_Y]) || !Number.isFinite(st[o + FLAT_VEL_X]) || !Number.isFinite(st[o + FLAT_VEL_Y]) || !Number.isFinite(st[o + FLAT_FREEZE_LEFT])) return `tick ${i} of the tape has a number that is not finite`;
  }
  let prev = 0;
  for (let k = 0; k < tape.gateAt.length; k++) {
    const g = tape.gateAt[k];
    if (!Number.isInteger(g) || g < prev || g > n) return `section ${k} ends at tick ${g}, out of order or past the tape`;

    if ((g - prev) % 2 !== 0 && !(k === tape.gateAt.length - 1 && sol?.complete === true)) return `section ${k} is ${g - prev} ticks, not an even number`;
    prev = g;
  }
  if (sol !== null) for (let k = 0; k < sol.sections.length; k++) if (sol.sections[k].ticks % 2 !== 0 && !(k === sol.sections.length - 1 && sol.complete)) return `section ${k} of the solution is ${sol.sections[k].ticks} ticks, not an even number`;
  return null;
}

function playableEnd(states: Float64Array): number {
  const n = states.length / S;
  for (let i = 1; i < n; i++) {
    if (Math.hypot(states[i * S + FLAT_POS_X] - states[(i - 1) * S + FLAT_POS_X], states[i * S + FLAT_POS_Y] - states[(i - 1) * S + FLAT_POS_Y]) > TELEPORT_PX) return i - 1;
  }
  return n - 1;
}

export class GoresDriver {
  readonly col: Collision;
  readonly source: CourseSource;
  readonly o: GoresDriverOpts;

  readonly clock = new RaceClock();
  readonly stats: GoresStats = { attempts: 0, finishes: 0, bestTicks: -1, lastTicks: -1, failedSections: [], rejoins: 0, rejoinFails: 0, kills: 0, shifts: 0, refound: 0 };
  private readonly startLines: number;
  private readonly now: () => number;
  private readonly roll: SimWorld;
  private readonly predSim: SimWorld;
  private readonly pred = new Float64Array(S);

  private readonly base = new Float64Array(S);
  private baseTick = -1;
  private readonly shadow = new Float64Array(SHADOW_TICKS * S);
  private shadowFrom = -1;
  private shadowCount = 0;
  private readonly aimBuf = emptyInput();
  private readonly idle = emptyInput();
  private readonly storedPlay: Play = { head: null, headTicks: 0, storedFrom: 0 };
  private sol: MapSolution | null = null;
  private tape: Stitched | null = null;
  private storedGrabs: Float64Array | null = null;

  private tapeEnd = 0;
  private clipped = false;

  private tapeRests = false;
  private play: Play = this.storedPlay;

  private tapeAt = -1;

  private aligned = false;
  private walker: PathWalker | null = null;
  private approachJob: Generator<void, void, void> | null = null;
  private approachSince = -1;
  private approachFails = 0;

  private settleSince = -1;

  private exact: { inputs: PlayerInput[]; states: Float64Array; next: number } | null = null;
  private startTries = 0;
  private job: Job | null = null;
  private lastJobDecisions = 0;
  private jobHoldoff = -1;
  private driftCount = 0;
  private offCount = 0;
  private rejoinFailsRow = 0;

  private lastStored = 0;
  private progressBest = -1e9;
  private progressTick = -1;

  private atPrefixEnd = false;
  private prefixKillAt = -1;
  private waiting = false;
  private gaveUpValue = false;
  private lastKill = -1_000_000;
  private killAsked = -1;
  private finishedAt = -1;
  private lastStep = -1;

  private onTape = false;

  private exactOn = false;

  private gaveUpAt = -1;
  private giveUpWait = GIVE_UP_RETRY_TICKS;
  private wasAlive = false;
  private lived = false;

  private played = false;
  private lastPos: { x: number; y: number } | null = null;
  private frozenSince = -1;
  private restSince = -1;
  private deepSince = -1;
  private lastFailedSection = -1;
  private sectionFailRun = 0;

  private sent: { tick: number; input: PlayerInput }[] = [];
  private lastInput: PlayerInput = emptyInput();
  private readonly notes: string[] = [];

  constructor(col: Collision, source: CourseSource, opts: Partial<GoresDriverOpts> = {}) {

    if (!float32) throw new Error("the gores driver needs the float physics: setFloat32(true) (core/float.ts)");
    this.col = col;
    this.source = source;
    this.o = { ...GORES_DRIVER_DEFAULTS, ...opts };

    this.o.rejoinPx = Number.isFinite(this.o.rejoinPx) ? Math.max(0, Math.min(REJOIN_PX_MAX, this.o.rejoinPx)) : GORES_DRIVER_DEFAULTS.rejoinPx;
    this.o.rejoinSpeed = Number.isFinite(this.o.rejoinSpeed) ? Math.max(0, this.o.rejoinSpeed) : GORES_DRIVER_DEFAULTS.rejoinSpeed;
    this.now = opts.now ?? (() => performance.now());
    this.startLines = raceLines(col).start.length;

    this.roll = new SimWorld(col, { respawnDelayTicks: 1_000_000, pickups: true });
    this.roll.addTee(0, { x: 0, y: 0 });
    this.predSim = new SimWorld(col, { respawnDelayTicks: 1_000_000, pickups: true });
    this.predSim.addTee(0, { x: 0, y: 0 });
  }

  get phase(): RacePhase {
    if (this.clock.state === "finished") return "done";
    return this.clock.state === "started" || this.startLines === 0 ? "finish" : "start";
  }

  get playable(): boolean {
    return this.tape !== null;
  }

  get gaveUp(): boolean {
    return this.gaveUpValue;
  }

  takeNotes(): string[] {
    return this.notes.splice(0, this.notes.length);
  }

  private note(s: string): void {
    this.notes.push(s);
    if (this.notes.length > 50) this.notes.shift();
  }

  noteKill(tick: number): void {
    if (tick > this.lastKill) this.lastKill = tick;
  }

  doing(self: TeeState | null): string {
    const at = self === null ? "" : ` at (${Math.trunc(self.pos.x / TILE)},${Math.trunc(self.pos.y / TILE)})`;
    if (this.phase === "done") return `finished in ${(this.clock.time / 50).toFixed(2)} s`;
    const sol = this.sol;
    if (sol === null) return "gores: the map is being solved, standing";
    const solved = `solved ${sol.solvedPrefix} of ${sol.total} sections`;
    if (this.tape === null) return `gores: ${solved}, but the solution could not be played, standing`;
    if (this.gaveUpValue) return `gores${at}: giving up after the same section failed ${this.sectionFailRun} runs in a row, standing`;
    const stop = this.clipped ? ", the route stops at a teleporter" : "";
    if (this.waiting) return `gores: ${solved}${stop}, waiting`;
    if (this.atPrefixEnd) return `gores${at}: at the end of the playable route (${solved}${stop}), asking for a restart`;
    if (this.walker !== null || !this.aligned) return `gores${at}: walking to the route's start`;
    const where = `section ${this.sectionOfStored(this.lastStored) + 1} of ${sol.total}`;
    const tail = sol.complete && !this.clipped ? "" : ` (${solved}${stop})`;
    if (this.job !== null) return `gores${at}: ${where}, rejoining the route${tail}`;
    return `gores${at}: ${where}, tick ${this.lastStored} of ${this.tapeEnd}${tail}`;
  }

  respawned(): void {
    const atEnd = this.atPrefixEnd;
    this.lived = false;
    this.played = false;
    this.clock.reset();
    this.finishedAt = -1;
    this.dropRun();
    if (atEnd) this.waiting = true;
    this.lastPos = null;
    this.resetKillTimers(-1);
  }

  resume(tick: number): void {
    this.resetKillTimers(tick);
    this.job = null;
    this.walker = null;
    this.approachJob = null;
    this.sent = [];
    this.shadowFrom = -1;
    this.baseTick = -1;
    this.lastPos = null;
  }

  private dropRun(): void {
    this.tapeAt = -1;
    this.play = this.storedPlay;
    this.aligned = false;
    this.walker = null;
    this.approachJob = null;
    this.approachSince = -1;
    this.approachFails = 0;
    this.settleSince = -1;
    this.exact = null;
    this.startTries = 0;
    this.job = null;
    this.jobHoldoff = -1;
    this.driftCount = 0;
    this.offCount = 0;
    this.rejoinFailsRow = 0;
    this.lastStored = 0;
    this.atPrefixEnd = false;
    this.prefixKillAt = -1;
    this.sent = [];
    this.lastInput = emptyInput();
    this.shadowFrom = -1;
    this.baseTick = -1;
  }

  private resetKillTimers(tick: number): void {
    this.frozenSince = -1;
    this.restSince = -1;
    this.deepSince = -1;
    this.progressBest = -1e9;
    this.progressTick = tick;
    this.killAsked = -1;
  }

  private forgetFailures(): void {
    this.sectionFailRun = 0;
    this.lastFailedSection = -1;
  }

  setSolution(sol: MapSolution | null): void {
    this.reset(sol);
    if (sol === null) return;
    let tape: Stitched;
    try {
      tape = stitch(this.col, sol);
    } catch (e) {
      this.note(`the solution does not stitch: ${messageOf(e)}`);
      return;
    }
    this.installTape(sol, tape);
  }

  setTape(sol: MapSolution, tape: Stitched): void {
    this.reset(sol);
    this.installTape(sol, tape);
  }

  private reset(sol: MapSolution | null): void {
    this.waiting = false;
    this.gaveUpValue = false;
    this.gaveUpAt = -1;
    this.giveUpWait = GIVE_UP_RETRY_TICKS;
    this.forgetFailures();
    this.sol = sol;
    this.tape = null;
    this.storedGrabs = null;
    this.tapeEnd = 0;
    this.clipped = false;
    this.dropRun();
  }

  private installTape(sol: MapSolution, tape: Stitched): void {
    const bad = tapeProblem(sol, tape);
    if (bad !== null) {
      this.note(`the solution is not played: ${bad}`);
      this.tape = null;
      this.storedGrabs = null;
      return;
    }
    const end = playableEnd(tape.states);
    if (end < 1) {
      this.note("the solution is not played: the tape jumps at its first tick");
      this.tape = null;
      this.storedGrabs = null;
      return;
    }
    this.sol = sol;
    this.tape = tape;
    this.tapeEnd = end;
    this.clipped = end < tape.states.length / S - 1;
    this.tapeRests = this.restsAt(tape.states);
    this.storedGrabs = this.o.aimThrows ? grabPoints(routeOf(tape.inputs, tape.states)) : null;
  }

  extend(sol: MapSolution): void {
    let tape: Stitched;
    try {
      tape = stitch(this.col, sol);
    } catch (e) {
      this.note(`the longer solution does not stitch, keeping the old one: ${messageOf(e)}`);
      return;
    }
    this.extendWith(sol, tape);
  }

  extendTape(sol: MapSolution, tape: Stitched): void {
    this.extendWith(sol, tape);
  }

  private extendWith(sol: MapSolution, tape: Stitched): void {
    const bad = tapeProblem(sol, tape);
    if (bad !== null || playableEnd(tape.states) < 1) {
      this.note(`the longer solution is not played, keeping the old one: ${bad ?? "the tape jumps at its first tick"}`);
      return;
    }
    const old = this.tape;
    if (old === null) {
      this.setTape(sol, tape);
      return;
    }
    const oldN = old.states.length / S;
    const newN = tape.states.length / S;
    const oldEnd = this.tapeEnd;

    let same = 0;
    const lim = Math.min(oldN, newN);
    while (same < lim && sameState(old.states, tape.states, same)) same++;
    const changed = same < oldN;
    const failedStart = this.lastFailedSection < 0 ? -1 : this.lastFailedSection === 0 ? 0 : (old.gateAt[this.lastFailedSection - 1] ?? 0);
    const reach = this.tapeAt < 0 ? -1 : Math.max(this.storedIndexOf(this.tapeAt), this.play.head === null ? 0 : this.play.storedFrom);
    const keep = this.tapeAt >= 0 && (!changed || reach + this.o.horizon < same);
    this.sol = sol;
    this.tape = tape;
    this.tapeEnd = playableEnd(tape.states);
    this.clipped = this.tapeEnd < newN - 1;
    this.tapeRests = this.restsAt(tape.states);
    this.storedGrabs = this.o.aimThrows ? grabPoints(routeOf(tape.inputs, tape.states)) : null;

    const more = this.tapeEnd > oldEnd || same <= oldEnd;
    const wake = this.clipped ? more : newN > oldN || changed || sol.complete;
    if (wake) {
      this.waiting = false;
      this.atPrefixEnd = false;
      this.prefixKillAt = -1;
    }
    if (this.gaveUpValue && (newN > oldN || same <= failedStart)) {
      this.gaveUpValue = false;
      this.gaveUpAt = -1;
      this.giveUpWait = GIVE_UP_RETRY_TICKS;
      this.forgetFailures();
    }

    if (this.job !== null && changed && Math.max(this.job.endStored, old.gateAt[this.job.goalSection] ?? oldEnd) >= same) this.job = null;
    if (keep) {
      this.note(`the solution grew to ${sol.solvedPrefix} of ${sol.total} sections, place kept`);
      return;
    }
    if (this.tapeAt >= 0) this.note(`the solution changed under the tee (from tick ${same} on): finding the route again`);
    this.tapeAt = -1;
    this.play = this.storedPlay;
    this.job = null;
    this.walker = null;
    this.approachJob = null;
    this.driftCount = 0;
    this.offCount = 0;
  }

  step(self: TeeState, tick: number, lag: number): RaceStep {
    let r: RaceStep;
    try {
      r = this.decide(self, tick, lag);

      if (r.input.fire !== 0 || (self.hookedPlayer >= 0 && r.input.hook !== 0)) {
        r = { input: { ...r.input, fire: 0, hook: self.hookedPlayer >= 0 ? 0 : r.input.hook }, kill: r.kill };
      }
    } catch (e) {
      this.job = null;
      this.walker = null;
      this.approachJob = null;
      this.note(`step failed: ${messageOf(e)}`);
      r = { input: this.idle, kill: false };
    }
    if (self.alive) {
      this.sent.push({ tick, input: r.input });
      while (this.sent.length > 0 && this.sent[0].tick + lag + 4 < tick) this.sent.shift();
      if (r.input !== this.idle) {
        this.lastInput = r.input;
        this.played = true;
      }
      try {
        this.castShadow(tick, lag);
      } catch {
        this.shadowFrom = -1;
      }
    } else this.shadowFrom = -1;
    return r;
  }

  private decide(self: TeeState, tick: number, lag: number): RaceStep {
    if (this.lastStep >= 0) {
      const gap = tick - this.lastStep;
      if (gap > DROP_GAP_TICKS) this.resume(tick);
      else if (gap > RESUME_GAP_TICKS) this.resetKillTimers(tick);
    }
    this.lastStep = tick;
    this.onTape = false;
    this.exactOn = false;
    if (!self.alive) {
      this.wasAlive = false;
      return { input: this.idle, kill: false };
    }
    if (!this.wasAlive) {
      this.wasAlive = true;
      this.respawned();
    }

    const prev = this.lastPos;
    const jumped = prev !== null && Math.hypot(self.pos.x - prev.x, self.pos.y - prev.y) > JUMP_PX;
    const seen = this.clock.observe(this.col, prev === null || jumped ? self.pos : prev, self.pos, tick);
    this.lastPos = { x: self.pos.x, y: self.pos.y };
    if (seen === "finish") {
      this.note(`finished in ${(this.clock.time / 50).toFixed(2)} s`);
      this.finishedAt = tick;
      this.stats.finishes++;
      this.stats.lastTicks = this.clock.time;
      if (this.stats.bestTicks < 0 || this.clock.time < this.stats.bestTicks) this.stats.bestTicks = this.clock.time;
      this.forgetFailures();

      this.giveUpWait = GIVE_UP_RETRY_TICKS;
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

    if (this.gaveUpValue && this.gaveUpAt > tick) this.gaveUpAt = tick;
    if (this.gaveUpValue && this.gaveUpAt >= 0 && tick - this.gaveUpAt >= this.giveUpWait) {
      this.gaveUpValue = false;
      this.gaveUpAt = -1;
      this.forgetFailures();
      this.note(`trying the route again (after ${Math.round(this.giveUpWait / 50)} s; the next wait is ${Math.round(Math.min(GIVE_UP_RETRY_MAX_TICKS, this.giveUpWait * 2) / 50)} s)`);
      this.giveUpWait = Math.min(GIVE_UP_RETRY_MAX_TICKS, this.giveUpWait * 2);
    }
    if (this.gaveUpValue && this.gaveUpAt < 0) this.gaveUpAt = tick;
    if (this.gaveUpValue || this.tape === null || this.waiting) return { input: this.idle, kill: false };
    if (!this.lived) {
      this.lived = true;
      this.stats.attempts++;
    }
    if (this.atPrefixEnd) return this.prefixEnd(self, tick, lag);

    if (this.killAsked >= 0 && tick - this.killAsked < this.o.killCooldownTicks) return { input: this.idle, kill: false };
    this.killAsked = -1;
    const why = this.killReason(self, tick);
    if (why !== null && tick - this.lastKill >= this.o.killCooldownTicks) {
      this.lastKill = tick;
      this.killAsked = tick;
      this.stats.kills++;
      this.recordFailure();
      this.note(`/kill: ${why}`);
      return { input: this.idle, kill: true };
    }
    return this.control(self, tick, lag);
  }

  private recordFailure(): void {
    const k = this.sectionOfStored(this.lastStored);
    this.stats.failedSections.push(k);
    if (this.stats.failedSections.length > MAX_FAILED_SECTIONS) this.stats.failedSections.shift();
    this.sectionFailRun = k === this.lastFailedSection ? this.sectionFailRun + 1 : 1;
    this.lastFailedSection = k;
    if (this.sectionFailRun >= this.o.maxSectionFails && !this.gaveUpValue) {
      this.gaveUpValue = true;
      this.note(`section ${k + 1} failed ${this.sectionFailRun} runs in a row, giving up and standing`);
    }
  }

  private killReason(self: TeeState, tick: number): string | null {
    const here = { tx: Math.trunc(self.pos.x / TILE), ty: Math.trunc(self.pos.y / TILE) };
    if (this.progressTick < 0) this.progressTick = tick;
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
    if (this.deepSince >= 0 && tick - this.deepSince >= this.o.deepKillTicks) return "deep-frozen";
    if (this.restSince >= 0 && tick - this.restSince >= this.o.restKillTicks) return `lying in the freeze at (${here.tx},${here.ty})`;
    if (this.frozenSince >= 0 && tick - this.frozenSince >= this.o.frozenKillTicks) return `frozen for ${tick - this.frozenSince} ticks`;

    const approaching = !this.aligned && this.approachSince >= 0 && tick - this.approachSince < APPROACH_MAX_TICKS;
    if (!approaching && tick - this.progressTick >= this.o.stallTicks) return `no progress along the route for ${tick - this.progressTick} ticks at (${here.tx},${here.ty})`;
    if (this.rejoinFailsRow >= this.o.maxRejoinFails) return `${this.rejoinFailsRow} rejoin searches failed in a row at (${here.tx},${here.ty})`;
    if (this.approachFails > MAX_APPROACH_FAILS) return "could not walk to the route's start";
    return null;
  }

  private control(self: TeeState, tick: number, lag: number): RaceStep {
    const pred = this.predict(self, tick, lag);
    const expected = this.tapeAt;
    let al = this.align(pred);

    if (!this.aligned) {

      const moving = Math.abs(pred[FLAT_VEL_X]) > 0.01 || Math.abs(pred[FLAT_VEL_Y]) > 0.01;

      if (moving && this.bearingOf(al) !== "on" && !this.played && pred[FLAT_FREEZE_LEFT] <= 0 && this.holdScore(pred, this.idle) < 1e5 - this.o.holdTicks) {
        if (this.settleSince < 0) this.settleSince = tick;
        if (tick - this.settleSince < SETTLE_MAX_TICKS) {
          this.progressTick = tick;
          return { input: this.idle, kill: false };
        }
      }
      const input = this.startInput(pred, al, self, tick, lag);
      if (input !== null) return { input, kill: false };
      this.aligned = true;
      this.walker = null;
      this.approachJob = null;
      this.exact = null;
      this.progressTick = tick;
    }
    const frozen = pred[FLAT_FREEZE_LEFT] > 0;
    let installed = false;
    let bearing = this.bearingOf(al);
    if (bearing === "on") {
      this.job = null;
      this.driftCount = 0;
      this.offCount = 0;
      this.rejoinFailsRow = 0;
    } else {
      this.driftCount = bearing === "drift" ? this.driftCount + 1 : 0;

      const wanted = !frozen && (bearing === "off" || (tick >= this.jobHoldoff && this.driftCount >= this.o.driftDecisions));

      if (this.job !== null && this.job.hold === null && bearing === "off") this.job = null;
      if (this.job === null && wanted) {
        this.job = this.startJob(pred, tick, al, bearing);
        if (this.job === null) this.failedSearch(bearing, tick, "no tape ahead to rejoin");
      }
      const job = this.job;
      if (job !== null) {
        if (job.done === null) {
          job.decisions++;
          try {
            const r = this.pumpGen(job.gen);
            if (r !== null) {
              job.done = { route: r.value };
              this.lastJobDecisions = job.decisions;
            }
          } catch (e) {
            this.note(`rejoin search failed: ${messageOf(e)}`);
            job.done = { route: null };
          }
        }

        const turn = job.startTick + (job.ahead > 0 ? job.ahead : MIN_LIVE_AHEAD_TICKS);
        if (job.done === null && tick >= turn && (this.o.pumpMs > 0 || this.o.pumpYields > 0)) {

          this.job = null;
          this.lastJobDecisions = Math.max(this.lastJobDecisions, 2 * job.decisions);
          if (job.ahead === 0 || job.ahead >= MAX_LIVE_AHEAD_TICKS) this.failedSearch(bearing, tick, "the search took longer than the tee could wait");
        } else if (job.done !== null) {

          const d = tick - (job.startTick + job.ahead);
          if (job.done.route === null) {
            this.job = null;
            this.failedSearch(bearing, tick, "no way back found");
          } else if (d >= 0) {
            this.job = null;
            const better = this.install(job.done.route, job, pred, tick, al, bearing, d);
            if (better !== null) {
              installed = true;
              al = better;
              bearing = this.bearingOf(al);
            }
          }
        }
      }
    }

    if (bearing !== "off" && (this.clipped || !(this.sol?.complete ?? false)) && al.index >= this.playLength() - PREFIX_END_TICKS) {
      this.atPrefixEnd = true;
      this.job = null;
      this.note(`end of the playable route (${this.sol?.solvedPrefix ?? 0} of ${this.sol?.total ?? 0} sections${this.clipped ? ", it stops at a teleporter" : ""}): asking for a /kill and waiting for more`);
      return this.prefixEnd(self, tick, lag);
    }

    if (this.job !== null && this.job.hold !== null) {
      this.offCount++;
      this.tapeAt = this.tapeAt >= 0 ? this.tapeAt + 2 : Math.max(0, al.near);
      return { input: this.job.hold, kill: false };
    }
    if (bearing !== "off") {
      this.noteProgress(al.index, tick);
      this.offCount = 0;

      if (!installed && expected >= 0 && al.index !== Math.min(expected, this.playLength() - 2)) this.stats.shifts++;
      const input = this.inputAt(al.index, pred[FLAT_POS_X], pred[FLAT_POS_Y], pred[FLAT_VEL_X], pred[FLAT_VEL_Y], emptyInput());
      this.tapeAt = al.index + 2;
      this.lastStored = this.storedIndexOf(al.index);
      this.onTape = bearing === "on";
      return { input, kill: false };
    }

    this.offCount++;
    this.tapeAt = this.tapeAt >= 0 ? this.tapeAt + 2 : Math.max(0, al.near);
    if (al.near >= 0) this.lastStored = this.storedIndexOf(al.near);
    return { input: this.hold(pred, al), kill: false };
  }

  private bearingOf(al: Align): Bearing {
    if (al.index < 0 || !(al.cost <= this.o.tolOff)) return "off";
    return al.cost <= this.o.tolOn ? "on" : "drift";
  }

  private noteProgress(index: number, tick: number): void {
    const stored = this.storedIndexOf(index);
    if (stored >= this.progressBest + this.o.stallGain) {
      this.progressBest = stored;
      this.progressTick = tick;
    }
  }

  private prefixEnd(self: TeeState, tick: number, lag: number): RaceStep {
    const ask = this.prefixKillAt < 0 ? tick - this.lastKill >= this.o.killCooldownTicks : tick - this.prefixKillAt >= PREFIX_REASK_TICKS;
    if (ask) {
      this.lastKill = tick;
      this.prefixKillAt = tick;
      this.forgetFailures();
      this.note("/kill: the end of the playable route");
      return { input: this.idle, kill: true };
    }
    return { input: this.hold(this.predict(self, tick, lag), null), kill: false };
  }

  private predict(self: TeeState, tick: number, lag: number): Float64Array {
    const sim = this.predSim;
    const k = tick - this.shadowFrom;
    if (this.shadowFrom >= 0 && k >= 1 && k <= this.shadowCount && this.agrees(self, (k - 1) * S)) sim.loadFlat(0, this.shadow, (k - 1) * S);
    else sim.applyTeeState(0, { ...self, id: 0 });
    sim.saveFlat(0, this.base, 0);
    this.baseTick = tick;
    let held = this.idle;
    for (const s of this.sent) if (s.tick + lag <= tick) held = s.input;
    for (let k = 0; k < lag; k++) {
      for (const s of this.sent) if (s.tick + lag === tick + k) held = s.input;
      sim.setInput(0, held);
      sim.step();
    }
    sim.saveFlat(0, this.pred, 0);
    return this.pred;
  }

  private restsAt(states: Float64Array): boolean {
    if (states[FLAT_VEL_X] !== 0 || states[FLAT_VEL_Y] !== 0 || states[FLAT_FREEZE_LEFT] > 0) return false;
    const roll = this.roll;
    roll.loadFlat(0, states, 0);
    roll.setInput(0, this.idle);
    roll.step();
    const core = roll.coreOf(0) as CharacterCore;
    return roll.isAlive(0) && roll.freezeTicksOf(0) <= 0 && core.pos.x === states[FLAT_POS_X] && core.pos.y === states[FLAT_POS_Y] && core.vel.x === 0 && core.vel.y === 0;
  }

  private agrees(self: TeeState, o: number): boolean {
    const sh = this.shadow;
    return (
      self.pos.x === sh[o + FLAT_POS_X] &&
      self.pos.y === sh[o + FLAT_POS_Y] &&
      Math.abs(self.vel.x - sh[o + FLAT_VEL_X]) < 1 / 512 &&
      Math.abs(self.vel.y - sh[o + FLAT_VEL_Y]) < 1 / 512 &&
      self.hookState === sh[o + FLAT_HOOK_STATE] &&

      self.hookPos.x === sh[o + FLAT_HOOK_X] &&
      self.hookPos.y === sh[o + FLAT_HOOK_Y] &&
      self.frozen === sh[o + FLAT_FREEZE_LEFT] > 0
    );
  }

  private castShadow(tick: number, lag: number): void {
    this.shadowFrom = -1;
    const from = this.baseTick;
    if (from < 0 || tick < from) return;
    const sim = this.predSim;
    sim.loadFlat(0, this.base, 0);
    let held = this.idle;
    for (const s of this.sent) if (s.tick + lag <= from) held = s.input;
    const n = Math.min(SHADOW_TICKS, tick - from + lag + 2);
    for (let k = 0; k < n; k++) {
      for (const s of this.sent) if (s.tick + lag === from + k) held = s.input;
      sim.setInput(0, held);
      sim.step();
      if (!sim.isAlive(0)) return;
      sim.saveFlat(0, this.shadow, k * S);
    }
    this.shadowFrom = from;
    this.shadowCount = n;
  }

  catchUp(self: TeeState, tick: number, lag: number, earliest: number = tick + 3): { tick: number; input: PlayerInput }[] {
    const out: { tick: number; input: PlayerInput }[] = [];
    if (this.lastStep < 0 || !self.alive) return out;
    const first = this.lastStep + 2;
    if (first >= tick || first + 1 + lag < earliest) return out;
    const k = tick - this.shadowFrom;
    if (!(this.shadowFrom >= 0 && k >= 1 && k <= this.shadowCount && this.agrees(self, (k - 1) * S))) return out;

    const ex = this.exact;
    if (this.exactOn && ex !== null && !this.aligned && this.tape !== null) {
      for (let d = first; d < tick && ex.next < ex.inputs.length; d += 2) {
        const input = ex.inputs[ex.next++];
        this.sent.push({ tick: d, input });
        out.push({ tick: d, input });
        this.lastStep = d;
      }
      if (out.length > 0) {
        try {
          this.castShadow(this.lastStep, lag);
        } catch {
          this.shadowFrom = -1;
        }
      }
      return out;
    }
    if (!this.onTape || this.tape === null || this.job !== null || this.atPrefixEnd || this.waiting || this.gaveUpValue || this.tapeAt < 0) return out;
    for (let d = first; d < tick; d += 2) {
      if (this.tapeAt >= this.playLength() - 1 - PREFIX_END_TICKS) break;
      const input = this.inputOf(this.tapeAt);
      this.sent.push({ tick: d, input });
      out.push({ tick: d, input });
      this.lastStored = this.storedIndexOf(this.tapeAt);
      this.tapeAt += 2;
      this.lastStep = d;
      if (input !== this.idle) this.lastInput = input;
    }
    if (out.length > 0) {
      try {
        this.castShadow(this.lastStep, lag);
      } catch {
        this.shadowFrom = -1;
      }
    }
    return out;
  }

  private playLength(): number {
    const p = this.play;
    return p.head === null ? this.tapeEnd + 1 : p.headTicks + 1 + (this.tapeEnd - p.storedFrom);
  }

  private arrOf(k: number): Float64Array {
    const p = this.play;
    return p.head !== null && k <= p.headTicks ? p.head.states : (this.tape as Stitched).states;
  }

  private offOf(k: number): number {
    const p = this.play;
    return (p.head !== null && k <= p.headTicks ? k : p.storedFrom + k - p.headTicks) * S;
  }

  private inputOf(k: number): PlayerInput {
    const p = this.play;
    if (p.head !== null && k < p.headTicks) return p.head.inputs[k];
    return (this.tape as Stitched).inputs[Math.min(this.tapeEnd - 1, p.storedFrom + k - p.headTicks)];
  }

  private storedIndexOf(k: number): number {
    const p = this.play;
    const i = p.head === null || k >= p.headTicks ? p.storedFrom + k - p.headTicks : p.storedFrom - (p.headTicks - k);
    return Math.max(0, Math.min(this.tapeEnd, i));
  }

  private sectionOfStored(i: number): number {
    const gates = this.tape?.gateAt ?? [];
    for (let k = 0; k < gates.length; k++) if (gates[k] >= i) return k;
    return Math.max(0, gates.length - 1);
  }

  private distTo(k: number, core: CharacterCore, frozen: boolean): number {
    return trackDist(this.arrOf(k), this.offOf(k), core, frozen);
  }

  private inputAt(k: number, x: number, y: number, vx: number, vy: number, out: PlayerInput): PlayerInput {
    const input = this.inputOf(k);
    if (!this.o.aimThrows) return input;
    const p = this.play;
    let grabs: Float64Array | null;
    let gi: number;
    if (p.head !== null && k < p.headTicks) {
      grabs = p.head.grabs;
      gi = k;
    } else {
      grabs = this.storedGrabs;
      gi = p.storedFrom + k - p.headTicks;
    }
    if (grabs === null || gi < 0 || 2 * gi + 1 >= grabs.length || Number.isNaN(grabs[2 * gi])) return input;
    const st = this.arrOf(k);
    const o = this.offOf(k);
    if (Math.abs(st[o + FLAT_POS_X] - x) <= AIM_SLACK_PX && Math.abs(st[o + FLAT_POS_Y] - y) <= AIM_SLACK_PX) return input;
    Object.assign(out, input);
    out.targetX = Math.round(grabs[2 * gi] - (x + vx / 2));
    out.targetY = Math.round(grabs[2 * gi + 1] - (y + vy / 2));
    if (out.targetX === 0 && out.targetY === 0) out.targetY = -1;
    return out;
  }

  private headOf(inputs: PlayerInput[], states: Float64Array): Head {
    return { inputs, states, grabs: this.o.aimThrows ? grabPoints(routeOf(inputs, states)) : null };
  }

  private rollCost(pred: Float64Array, a: number): number {
    const N = this.playLength();
    const roll = this.roll;
    const core = roll.coreOf(0) as CharacterCore;
    roll.loadFlat(0, pred, 0);
    let played = 0;
    let along = 0;
    const head = this.play.head !== null && a < this.play.headTicks ? this.play.headTicks - a : Infinity;
    const horizon = Math.min(this.o.horizon, Math.max(2, head));
    for (let k = 0; k < horizon; k++) {
      if ((k & 1) === 0) roll.setInput(0, this.inputAt(Math.min(a + k, N - 2), core.pos.x, core.pos.y, core.vel.x, core.vel.y, this.aimBuf));
      roll.step();
      played++;
      if (!roll.isAlive(0)) return Infinity;
      if (a + played >= N - 1) break;
      if (k % 3 === 2) along += this.distTo(a + played, core, roll.freezeTicksOf(0) > 0);
    }
    const frozen = roll.freezeTicksOf(0) > 0;
    let c = this.distTo(Math.min(a + played, N - 1), core, frozen) + along / 10;
    if (frozen && Math.abs(core.vel.x) < 0.3 && Math.abs(core.vel.y) < 0.6 && (this.col.isAnyFreeze(core.pos.x, core.pos.y) || roll.isDeepFrozen(0))) c += 1000;
    return c;
  }

  private immediate(pred: Float64Array, k: number): number {
    const roll = this.roll;
    roll.loadFlat(0, pred, 0);
    return this.distTo(k, roll.coreOf(0) as CharacterCore, pred[FLAT_FREEZE_LEFT] > 0);
  }

  private alignWindow(pred: Float64Array, centre: number, w: number): Align {
    const N = this.playLength();
    const c = Math.max(0, Math.min(N - 2, centre));
    let index = -1;
    let cost = Infinity;
    for (let a = Math.max(0, c - w); a <= Math.min(N - 2, c + w); a++) {
      const r = this.rollCost(pred, a);
      if (r === Infinity) continue;
      const t = r + SHIFT_COST * Math.abs(a - c);
      if (t < cost) {
        cost = t;
        index = a;
      }
    }
    return { index, cost, d0: index < 0 ? Infinity : this.immediate(pred, index), near: index };
  }

  private alignGlobal(pred: Float64Array): Align {
    const N = this.playLength();
    const roll = this.roll;
    roll.loadFlat(0, pred, 0);
    const core = roll.coreOf(0) as CharacterCore;
    const frozen = pred[FLAT_FREEZE_LEFT] > 0;
    let bi = -1;
    let bd = Infinity;
    for (let i = 0; i <= N - 2; i++) {
      const d = this.distTo(i, core, frozen);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    if (bi < 0) return { index: -1, cost: Infinity, d0: Infinity, near: -1 };
    let index = -1;
    let cost = Infinity;
    for (let a = Math.max(0, bi - GLOBAL_SPREAD); a <= Math.min(N - 2, bi + GLOBAL_SPREAD); a++) {
      const r = this.rollCost(pred, a);
      if (r === Infinity) continue;
      const t = r + SHIFT_COST * Math.abs(a - bi);
      if (t < cost) {
        cost = t;
        index = a;
      }
    }
    return { index, cost, d0: bd, near: bi };
  }

  private align(pred: Float64Array): Align {
    if (this.tapeAt < 0) return this.alignGlobal(pred);
    const win = this.alignWindow(pred, this.tapeAt, this.offCount > 0 ? this.o.holdWindow : this.o.alignWindow);
    if (win.index >= 0 && win.cost <= this.o.tolOff) return win;
    const glob = this.alignGlobal(pred);
    if (glob.index >= 0 && (win.index < 0 || glob.cost < win.cost)) {
      if (glob.cost <= this.o.tolOff && Math.abs(glob.index - this.tapeAt) > this.o.holdWindow) {
        this.stats.refound++;
        this.note(`found the route again at tick ${this.storedIndexOf(glob.index)} of ${this.tapeEnd}`);
      }
      return glob;
    }
    return win.index >= 0 ? win : glob;
  }

  private hold(pred: Float64Array, al: Align | null): PlayerInput {
    const N = this.playLength();
    const at = al !== null && al.near >= 0 ? al.near : this.tapeAt;
    const cands = [this.idle, this.lastInput];
    if (at >= 0) cands.push(this.inputAt(Math.min(N - 2, at), pred[FLAT_POS_X], pred[FLAT_POS_Y], pred[FLAT_VEL_X], pred[FLAT_VEL_Y], emptyInput()));
    let best = this.idle;
    let bestScore = Infinity;
    for (const c of cands) {
      const s = this.holdScore(pred, c);
      if (s < bestScore) {
        bestScore = s;
        best = c;
      }
    }
    return best;
  }

  private holdScore(pred: Float64Array, input: PlayerInput): number {
    const roll = this.roll;
    const core = roll.coreOf(0) as CharacterCore;
    roll.loadFlat(0, pred, 0);
    for (let t = 0; t < this.o.holdTicks; t++) {
      if ((t & 1) === 0) roll.setInput(0, input);
      roll.step();
      if (!roll.isAlive(0)) return 1e6;
      if (roll.freezeTicksOf(0) > 0) return 1e5 - t;
    }
    const grounded = this.col.isSolid(core.pos.x + HALF, core.pos.y + HALF + 5) || this.col.isSolid(core.pos.x - HALF, core.pos.y + HALF + 5);
    return (grounded ? 0 : 200) + 5 * Math.hypot(core.vel.x, core.vel.y);
  }

  private rolledAhead(st: Float64Array, input: PlayerInput, ticks: number): Float64Array | null {
    const roll = this.roll;
    roll.loadFlat(0, st, 0);
    for (let t = 0; t < ticks; t++) {
      if ((t & 1) === 0) roll.setInput(0, input);
      roll.step();
      if (!roll.isAlive(0)) return null;
    }
    const out = new Float64Array(S);
    roll.saveFlat(0, out, 0);
    return out;
  }

  private rolledAlong(st: Float64Array, a: number, ticks: number): Float64Array | null {
    const N = this.playLength();
    const roll = this.roll;
    const core = roll.coreOf(0) as CharacterCore;
    roll.loadFlat(0, st, 0);
    for (let t = 0; t < ticks; t++) {
      if ((t & 1) === 0) roll.setInput(0, this.inputAt(Math.min(a + t, N - 2), core.pos.x, core.pos.y, core.vel.x, core.vel.y, this.aimBuf));
      roll.step();
      if (!roll.isAlive(0)) return null;
    }
    const out = new Float64Array(S);
    roll.saveFlat(0, out, 0);
    return out;
  }

  private pumpGen<T>(gen: Generator<void, T, void>): { value: T } | null {
    const until = this.o.pumpMs > 0 ? this.now() + this.o.pumpMs : Infinity;
    let slices = 0;
    for (;;) {
      const r = gen.next();
      if (r.done === true) return { value: r.value };
      slices++;
      if (this.o.pumpYields > 0 && slices >= this.o.pumpYields) return null;
      if (until !== Infinity && this.now() >= until) return null;
    }
  }

  private startInput(pred: Float64Array, al: Align, self: TeeState, tick: number, lag: number): PlayerInput | null {
    const tape = this.tape as Stitched;
    const near = al.index >= 0 && al.d0 <= this.o.tolOff;
    const x0 = tape.states[FLAT_POS_X];
    const y0 = tape.states[FLAT_POS_Y];

    if (this.tapeRests) {
      if (pred[FLAT_POS_X] === x0 && pred[FLAT_POS_Y] === y0 && Math.abs(pred[FLAT_VEL_X]) <= REST_SPEED && pred[FLAT_VEL_Y] === 0 && pred[FLAT_FREEZE_LEFT] <= 0) return null;
    } else if (this.bearingOf(al) === "on") return null;
    if (!this.tapeRests) {
      if (near) return null;
      return this.approach(self, tick, lag);
    }

    if (this.startTries >= MAX_START_TRIES) {
      this.approachFails = MAX_APPROACH_FAILS + 1;
      return this.idle;
    }
    const ex = this.exact;
    if (ex !== null) {
      const o = ex.next * S;
      const onPlan = ex.next < ex.inputs.length && pred[FLAT_POS_X] === ex.states[o + FLAT_POS_X] && pred[FLAT_POS_Y] === ex.states[o + FLAT_POS_Y] && pred[FLAT_VEL_X] === ex.states[o + FLAT_VEL_X] && pred[FLAT_VEL_Y] === ex.states[o + FLAT_VEL_Y];
      if (onPlan) {
        this.exactOn = true;
        return ex.inputs[ex.next++];
      }

      this.exact = null;
    }
    const onFloor = pred[FLAT_POS_Y] === y0 && Math.abs(pred[FLAT_POS_X] - x0) <= EXACT_REACH_PX && pred[FLAT_FREEZE_LEFT] <= 0;
    const still = Math.abs(pred[FLAT_VEL_X]) <= REST_SPEED && pred[FLAT_VEL_Y] === 0;

    if (onFloor && (this.walker === null || still)) {
      this.walker = null;
      this.approachJob = null;

      if (!still) return this.idle;
      const plan = this.exactWalk(pred, x0, y0);
      if (plan !== null && plan.inputs.length > 0) {
        this.exact = { inputs: plan.inputs, states: plan.states, next: 1 };
        this.exactOn = true;
        return plan.inputs[0];
      }
      this.startTries++;
      this.note(`no exact way along the floor to the route's start (${Math.round(pred[FLAT_POS_X] - x0)} px off)`);
      return this.idle;
    }
    const walking = this.walker !== null;
    const input = this.approach(self, tick, lag);

    if (walking && this.walker === null) this.startTries++;
    return input;
  }

  private exactWalk(from: Float64Array, x0: number, y0: number): { inputs: PlayerInput[]; states: Float64Array } | null {
    const roll = this.roll;
    const inputs = [-1, 0, 1].map((d) => ({ ...emptyInput(), direction: d }));

    const play = (dirs: readonly number[]): Float64Array | null => {
      const out = new Float64Array((dirs.length + 1) * S);
      out.set(from.subarray(0, S), 0);
      roll.loadFlat(0, from, 0);
      for (let i = 0; i < dirs.length; i++) {
        roll.setInput(0, inputs[dirs[i]]);
        roll.step();
        roll.step();
        if (!roll.isAlive(0) || roll.freezeTicksOf(0) > 0) return null;
        roll.saveFlat(0, out, (i + 1) * S);
        if (out[(i + 1) * S + FLAT_POS_Y] !== y0) return null;
      }
      return out;
    };

    const toward = from[FLAT_POS_X] < x0 ? 2 : 0;
    const runs: { dirs: number[]; end: Float64Array; off: number }[] = [];
    const end = new Float64Array(S);
    for (let k = 0; k <= EXACT_MAX_RUN; k++) {
      const dirs: number[] = new Array<number>(k).fill(toward);

      if (play(dirs) === null) continue;
      roll.saveFlat(0, end, 0);

      let ok = true;
      for (let c = 0; c < 16 && Math.abs(end[FLAT_VEL_X]) > REST_SPEED; c++) {
        dirs.push(1);
        roll.setInput(0, inputs[1]);
        roll.step();
        roll.step();
        if (!roll.isAlive(0) || roll.freezeTicksOf(0) > 0) {
          ok = false;
          break;
        }
        roll.saveFlat(0, end, 0);
        if (end[FLAT_POS_Y] !== y0) {
          ok = false;
          break;
        }
      }
      if (!ok || Math.abs(end[FLAT_VEL_X]) > REST_SPEED) continue;
      runs.push({ dirs, end: end.slice(), off: Math.abs(end[FLAT_POS_X] - x0) });

      if ((end[FLAT_POS_X] - x0) * (toward === 2 ? 1 : -1) > EXACT_FINE_PX) break;
    }
    runs.sort((a, b) => a.off - b.off);

    const budget = { left: EXACT_MAX_NODES };
    for (const r of runs.slice(0, EXACT_RUNS_TRIED)) {
      if (r.off > EXACT_FINE_PX || budget.left <= 0) break;
      const fine = this.exactFine(r.end, x0, y0, budget);
      if (fine === null) continue;
      const dirs = [...r.dirs, ...fine];
      const states = play(dirs);
      if (states === null) continue;
      const o = dirs.length * S;
      if (states[o + FLAT_POS_X] !== x0 || Math.abs(states[o + FLAT_VEL_X]) > REST_SPEED || states[o + FLAT_VEL_Y] !== 0) continue;
      return { inputs: dirs.map((d) => inputs[d]), states };
    }
    return null;
  }

  private exactFine(from: Float64Array, x0: number, y0: number, budget: { left: number }): number[] | null {

    if (from[FLAT_POS_X] === x0 && Math.abs(from[FLAT_VEL_X]) <= REST_SPEED && from[FLAT_VEL_Y] === 0) return [];
    const cap = Math.max(1, Math.ceil(budget.left * EXACT_FINE_SHARE));
    const roll = this.roll;
    const reach = Math.abs(from[FLAT_POS_X] - x0) + EXACT_FINE_PX;
    let states = new Float64Array(1024 * S);
    const parent: number[] = [-1];
    const dirOf: number[] = [0];
    const depth: number[] = [0];
    states.set(from.subarray(0, S), 0);
    const seen = new Set<number>();

    const keyOf = (st: Float64Array, o: number): number => (Math.round(st[o + FLAT_POS_X]) * 16384 + Math.round(st[o + FLAT_VEL_X] * 256) + 8192) * 2 + (st[o + FLAT_VEL_Y] !== 0 ? 1 : 0);
    seen.add(keyOf(states, 0));
    const inputs = [-1, 0, 1].map((d) => ({ ...emptyInput(), direction: d }));
    let goal = -1;

    const need = (o: number): number => Math.ceil(Math.abs(states[o + FLAT_POS_X] - x0) / 20) + (Math.abs(states[o + FLAT_VEL_X]) > REST_SPEED ? 1 : 0);
    const heapKey: number[] = [];
    const heapNode: number[] = [];
    const push = (key: number, node: number): void => {
      let i = heapKey.length;
      heapKey.push(key);
      heapNode.push(node);
      while (i > 0) {
        const up = (i - 1) >> 1;
        if (heapKey[up] <= key) break;
        heapKey[i] = heapKey[up];
        heapNode[i] = heapNode[up];
        i = up;
      }
      heapKey[i] = key;
      heapNode[i] = node;
    };
    const pop = (): number => {
      const top = heapNode[0];
      const key = heapKey.pop() as number;
      const node = heapNode.pop() as number;
      const len = heapKey.length;
      if (len > 0) {
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          if (l >= len) break;
          const c = l + 1 < len && heapKey[l + 1] < heapKey[l] ? l + 1 : l;
          if (heapKey[c] >= key) break;
          heapKey[i] = heapKey[c];
          heapNode[i] = heapNode[c];
          i = c;
        }
        heapKey[i] = key;
        heapNode[i] = node;
      }
      return top;
    };
    push(2 * need(0), 0);
    while (heapKey.length > 0 && goal < 0) {
      const n = pop();
      if (depth[n] >= EXACT_MAX_DECISIONS) continue;
      for (let a = 0; a < 3 && goal < 0; a++) {
        roll.loadFlat(0, states, n * S);
        roll.setInput(0, inputs[a]);
        roll.step();
        roll.step();
        if (!roll.isAlive(0) || roll.freezeTicksOf(0) > 0) continue;
        const m = parent.length;
        if ((m + 1) * S > states.length) {
          const grown = new Float64Array(states.length * 2);
          grown.set(states);
          states = grown;
        }
        roll.saveFlat(0, states, m * S);
        const o = m * S;
        if (states[o + FLAT_POS_Y] !== y0 || Math.abs(states[o + FLAT_VEL_Y]) > 1 || Math.abs(states[o + FLAT_POS_X] - x0) > reach) continue;
        const k = keyOf(states, o);
        if (seen.has(k)) continue;
        seen.add(k);
        parent.push(n);
        dirOf.push(a);
        depth.push(depth[n] + 1);
        if (states[o + FLAT_POS_X] === x0 && Math.abs(states[o + FLAT_VEL_X]) <= REST_SPEED && states[o + FLAT_VEL_Y] === 0) goal = m;
        else push(depth[m] + 2 * need(o), m);
        if (parent.length >= cap) break;
      }
      if (parent.length >= cap) break;
    }
    budget.left -= parent.length;
    if (goal < 0) return null;
    const chain: number[] = [];
    for (let m = goal; m > 0; m = parent[m]) chain.push(dirOf[m]);
    chain.reverse();
    return chain;
  }

  private approach(self: TeeState, tick: number, lag: number): PlayerInput {
    if (this.approachSince < 0) this.approachSince = tick;
    if (this.walker === null) {
      const tape = this.tape as Stitched;
      const tx = Math.trunc(tape.states[FLAT_POS_X] / TILE);
      const ty = Math.trunc(tape.states[FLAT_POS_Y] / TILE);
      const goal: PathGoal = { zone: [{ x0: tx - 1, y0: ty - 1, x1: tx + 1, y1: ty + 1 }], spots: [{ tx, ty }], stop: false, thaw: true };
      this.approachJob ??= this.approachField(goal);
      try {
        if (this.pumpGen(this.approachJob) === null) return this.idle;
      } catch (e) {
        this.note(`planning the way to the route's start failed: ${messageOf(e)}`);
        this.approachJob = null;
        this.approachFails++;
        return this.idle;
      }
      this.approachJob = null;
      this.walker = new PathWalker(this.col, goal, { tx: Math.trunc(self.pos.x / TILE), ty: Math.trunc(self.pos.y / TILE) }, { search: this.source.search, clock: this.now, library: null, maxTicks: APPROACH_MAX_TICKS });
    }
    const input = this.walker.step(self, tick, lag);
    if (this.walker.phase === "walking") return input;

    if (this.walker.phase === "failed") {
      this.note(`walking to the route's start failed (${this.walker.reason})`);
      this.approachFails++;
    }
    this.walker = null;
    return this.idle;
  }

  private *approachField(goal: PathGoal): Generator<void, void, void> {
    const s = this.source.search;
    yield* fieldOfGen(this.col, goal, s.v ?? DEFAULT_SEARCH.v, s.gores ?? DEFAULT_SEARCH.gores);
  }

  private rejoinOptions(tube: Float64Array, ticks: number): Partial<PathSearchOpts> {
    return {
      clearPx: REJOIN_CLEARANCE_PX,
      clearCost: REJOIN_CLEARANCE_COST,
      ...this.source.search,
      particles: 1,
      maxNodes: this.o.rejoinNodes,
      maxExpansions: this.o.rejoinExpansions,
      improveExpansions: REJOIN_IMPROVE_EXPANSIONS,
      timeLimitMs: 1e9,
      corridor: this.o.corridorPx > 0 ? { states: tube, lo: 0, hi: ticks, px: this.o.corridorPx } : null,
    };
  }

  private liveAhead(): number {
    if (this.o.pumpMs <= 0 && this.o.pumpYields <= 0) return 0;
    const e = Math.min(MAX_LIVE_AHEAD_TICKS, Math.max(MIN_LIVE_AHEAD_TICKS, 2 * this.lastJobDecisions));
    return e + (e & 1);
  }

  private startJob(pred: Float64Array, tick: number, al: Align, bearing: Bearing): Job | null {
    const sol = this.sol;
    if (sol === null || this.tape === null || sol.sections.length === 0) return null;
    const N = this.playLength();
    const centre = Math.max(0, Math.min(N - 2, al.index >= 0 ? al.index : al.near >= 0 ? al.near : this.tapeAt));

    const follow = bearing === "drift" && al.index >= 0;
    const hold = follow ? null : this.hold(pred, al);
    let ahead = this.liveAhead();
    let from: Float64Array | null = ahead <= 0 ? pred.slice(0, S) : hold === null ? this.rolledAlong(pred, al.index, ahead) : this.rolledAhead(pred, hold, ahead);
    if (from === null) {

      ahead = 0;
      from = pred.slice(0, S);
    }
    const lo = Math.max(0, centre - REJOIN_LOOKBACK_TICKS);
    const hi = Math.min(N - 1, centre + ahead + this.o.rejoinWindowTicks);
    if (hi - lo < MIN_REJOIN_WINDOW_TICKS) return null;
    const endStored = this.storedIndexOf(hi);
    const goalSection = Math.min(this.sectionOfStored(endStored), sol.sections.length - 1);

    const gateStored = Math.min(this.tapeEnd, this.tape.gateAt[goalSection] ?? this.tapeEnd);
    const gatePlay = this.play.headTicks + (gateStored - this.play.storedFrom);
    const tubeHi = Math.min(N - 1, Math.max(hi, gatePlay + CORRIDOR_PAST_GATE_TICKS));
    const win = new Float64Array((tubeHi - lo + 1) * S);
    for (let k = lo; k <= tubeHi; k++) win.set(this.arrOf(k).subarray(this.offOf(k), this.offOf(k) + S), (k - lo) * S);
    const s = sol.sections[goalSection];
    const section: Section = { idx: goalSection, label: `s${goalSection}`, from: s.from, to: s.to, tiles: 0 };
    const goal = this.source.goal(section);
    const around = { tx: Math.trunc(from[FLAT_POS_X] / TILE), ty: Math.trunc(from[FLAT_POS_Y] / TILE) };
    return { gen: this.rejoinSearch(from, win, hi - lo, tubeHi - lo, goal, around), base: lo, hi, startTick: tick, ahead, hold, goalSection, endStored, decisions: 0, done: null };
  }

  private *rejoinSearch(start: Float64Array, win: Float64Array, ticks: number, tubeTicks: number, goal: PathGoal, around: { tx: number; ty: number }): Generator<void, Route | null, void> {
    const opts = this.rejoinOptions(win, tubeTicks);

    yield* fieldOfGen(this.col, goal, opts.v ?? DEFAULT_SEARCH.v, opts.gores ?? DEFAULT_SEARCH.gores);
    const searcher = new PathSearcher(this.col, goal, opts, around);

    searcher.setRejoin(routeOf([], win.subarray(0, (ticks + 1) * S)), 0, ticks, { px: this.o.rejoinPx, speed: this.o.rejoinSpeed });
    const gen = searcher.searchGen(start, MACRO_ROOT, this.o.rejoinNodes);
    for (;;) {
      const r = gen.next();
      if (r.done === true) return r.value;
      yield;
    }
  }

  private failedSearch(bearing: Bearing, tick: number, why: string): void {
    this.stats.rejoinFails++;
    if (bearing === "off") this.rejoinFailsRow++;
    else this.jobHoldoff = tick + this.o.rejoinHoldoffTicks;
    this.note(`rejoin: ${why}`);
  }

  private install(route: Route, job: Job, pred: Float64Array, tick: number, al: Align, bearing: Bearing, d: number): Align | null {
    const play = this.splice(route, job);
    if (play === null) {
      this.failedSearch(bearing, tick, "the route meets the tape off the decisions' parity");
      return null;
    }
    const old = this.play;
    this.play = play;
    const aligned = this.alignWindow(pred, d, this.o.holdWindow);
    if (aligned.index < 0 || !(aligned.cost <= this.o.tolOff)) {
      this.play = old;
      this.failedSearch(bearing, tick, "the tee was past its route when it came");
      return null;
    }
    if (bearing !== "off" && !(aligned.cost < al.cost)) {
      this.play = old;
      this.jobHoldoff = tick + this.o.rejoinHoldoffTicks;
      return null;
    }
    this.stats.rejoins++;
    this.rejoinFailsRow = 0;
    this.driftCount = 0;
    this.offCount = 0;
    this.note(`rejoined the route (${route.ticks} ticks of detour)`);
    return aligned;
  }

  private splice(route: Route, job: Job): Play | null {
    const old = this.play;
    const clamp = (i: number): number => Math.max(0, Math.min(this.tapeEnd, i));

    const parity = (j: number): boolean => ((route.ticks - j) & 1) === 0;
    if (route.rejoinAt === undefined) {
      const gates = (this.tape as Stitched).gateAt;

      const gate = clamp(gates[Math.min(job.goalSection, gates.length - 1)] ?? this.tapeEnd);
      const roll = this.roll;
      roll.loadFlat(0, route.states, route.ticks * S);
      const core = roll.coreOf(0) as CharacterCore;
      const frozen = roll.freezeTicksOf(0) > 0;
      const stored = (this.tape as Stitched).states;
      let at = -1;
      let best = Infinity;
      for (let i = Math.max(0, gate - GOAL_JOIN_TICKS); i <= Math.min(this.tapeEnd, gate + GOAL_JOIN_TICKS); i++) {
        if (!parity(i)) continue;
        const dist = trackDist(stored, i * S, core, frozen);
        if (dist < best) {
          best = dist;
          at = i;
        }
      }
      if (at < 0) return null;
      return { head: this.headOf(route.inputs, route.states), headTicks: route.ticks, storedFrom: at };
    }
    let j = job.base + route.rejoinAt;
    if (!parity(j)) j = j + 1 <= job.hi ? j + 1 : j - 1 >= job.base ? j - 1 : -1;
    if (j < 0) return null;
    if (old.head === null || j >= old.headTicks) {
      return { head: this.headOf(route.inputs, route.states), headTicks: route.ticks, storedFrom: clamp(old.storedFrom + j - old.headTicks) };
    }
    const keep = old.headTicks - j;
    const inputs = [...route.inputs, ...old.head.inputs.slice(j)];
    const states = new Float64Array((route.ticks + keep + 1) * S);
    states.set(route.states.subarray(0, (route.ticks + 1) * S), 0);
    states.set(old.head.states.subarray((j + 1) * S, (old.headTicks + 1) * S), (route.ticks + 1) * S);
    return { head: this.headOf(inputs, states), headTicks: route.ticks + keep, storedFrom: old.storedFrom };
  }
}

function sameState(a: Float64Array, b: Float64Array, i: number): boolean {
  const o = i * S;
  return Math.abs(a[o + FLAT_POS_X] - b[o + FLAT_POS_X]) <= 0.5 && Math.abs(a[o + FLAT_POS_Y] - b[o + FLAT_POS_Y]) <= 0.5 && Math.abs(a[o + FLAT_VEL_X] - b[o + FLAT_VEL_X]) <= 0.5 && Math.abs(a[o + FLAT_VEL_Y] - b[o + FLAT_VEL_Y]) <= 0.5;
}
