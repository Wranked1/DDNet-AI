import type { Collision } from "../core/collision.ts";
import { SimWorld } from "../core/world.ts";
import type { SimState } from "../core/world.ts";
import type { PlayerInput, TeeState } from "../core/types.ts";
import { emptyInput } from "../core/types.ts";
import { HOOK_GRABBED } from "../core/characterCore.ts";
import { TUNING } from "../core/tuning.ts";

export type TileBox = { x0: number; y0: number; x1: number; y1: number };

export function inBox(b: TileBox, tx: number, ty: number): boolean {
  return tx >= b.x0 && tx <= b.x1 && ty >= b.y0 && ty <= b.y1;
}

export function inAnyBox(boxes: readonly TileBox[], tx: number, ty: number): boolean {
  for (const b of boxes) if (inBox(b, tx, ty)) return true;
  return false;
}

export function shiftBox(b: TileBox, dx: number, dy: number): TileBox {
  return { x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy };
}

export type Crossing = {
  label: string;

  from: readonly TileBox[];

  chamber: TileBox;

  start: { tx: number; ty: number };

  anchors: readonly { tx: number; ty: number }[];

  directAnchors?: readonly number[];

  landing: readonly TileBox[];

  exit: readonly TileBox[];

  exitTile: { tx: number; ty: number };

  hall?: readonly TileBox[];

  hallTile?: { tx: number; ty: number };

  toward: -1 | 1;

  wall?: WallRoute;
};

export type WallRoute = {

  anchors: readonly { tx: number; ty: number }[];

  shelf: readonly TileBox[];

  room: readonly TileBox[];

  lastRow: number;

  missRow: number;
};

function shiftWall(w: WallRoute, dx: number, dy: number): WallRoute {
  return {
    anchors: w.anchors.map((a) => ({ tx: a.tx + dx, ty: a.ty + dy })),
    shelf: w.shelf.map((b) => shiftBox(b, dx, dy)),
    room: w.room.map((b) => shiftBox(b, dx, dy)),
    lastRow: w.lastRow + dy,
    missRow: w.missRow + dy,
  };
}

export function shiftCrossing(c: Crossing, dx: number, dy: number): Crossing {
  return {
    ...c,
    from: c.from.map((b) => shiftBox(b, dx, dy)),
    chamber: shiftBox(c.chamber, dx, dy),
    start: { tx: c.start.tx + dx, ty: c.start.ty + dy },
    anchors: c.anchors.map((a) => ({ tx: a.tx + dx, ty: a.ty + dy })),
    landing: c.landing.map((b) => shiftBox(b, dx, dy)),
    exit: c.exit.map((b) => shiftBox(b, dx, dy)),
    exitTile: { tx: c.exitTile.tx + dx, ty: c.exitTile.ty + dy },
    hall: c.hall?.map((b) => shiftBox(b, dx, dy)),
    hallTile: c.hallTile === undefined ? undefined : { tx: c.hallTile.tx + dx, ty: c.hallTile.ty + dy },
    ...(c.wall !== undefined ? { wall: shiftWall(c.wall, dx, dy) } : {}),
  };
}

const TILE_PX = 32;
const centre = (t: number): number => t * TILE_PX + TILE_PX / 2;
const tileOf = (px: number): number => Math.trunc(px / TILE_PX);

export function wallRouteOk(col: Collision, c: Crossing): boolean {
  const w = c.wall;
  if (w === undefined) return false;
  for (const a of w.anchors) {
    if (a.tx < 0 || a.ty < 0 || a.tx >= col.width || a.ty >= col.height) return false;
    const x = a.tx * TILE_PX + TILE_PX / 2;
    const y = a.ty * TILE_PX + TILE_PX / 2;
    if (!col.isSolid(x, y) || col.isNoHook(x, y)) return false;
  }
  for (const b of [...w.shelf, ...w.room]) {
    if (b.x0 < 0 || b.y0 < 0 || b.x1 >= col.width || b.y1 + 1 >= col.height) return false;
    let floor = false;
    for (let x = b.x0; x <= b.x1 && !floor; x++) floor = col.isSolid(x * TILE_PX + TILE_PX / 2, (b.y1 + 1) * TILE_PX + TILE_PX / 2);
    if (!floor) return false;
  }
  return true;
}

const HOLDS = [10, 16, 24, 40];

const PUSH_AFTER_TICKS = 30;

const SETTLE_TICKS = 110;

const HOP_RUNS = [10, 20, 40];
const HOP_JUMP_AT = [0, 2, 4, 6, 8, 10, 14];
const HOP_JUMP_HOLD = [6, 14];
const HOP_TICKS = 90;

const DROP_RUNS = [0, 6, 12, 24];
const DROP_TICKS = 260;

const AIR_RUNS = [4, 10, 20, 40];
const AIR_JUMP_AT = [-1, 0, 3];
const MAX_HOPS = 3;

const DIRECT_HOLDS = [32, 40];
const DIRECT_STEER: readonly (readonly [number, number])[] = [
  [12, 0], [16, 3], [8, 0], [16, 6], [24, 6], [30, 6], [30, 10], [12, 3],
];

export const DIRECT_SAME_TICKS = Math.min(...DIRECT_STEER.map(([push]) => push));

export const DIRECT_SETTLE_TICKS = 70;

const DIRECT_ENTER_TICKS = 50;

const DIRECT_ARRIVE_DEPTH_TILES = 7;

const DIRECT_WAIT_TICKS = 45;

const SPREAD_TICKS = 2;

const SPREAD_EARLY_TICKS = 1;

const NUDGE_PX = 6;
const NUDGE_Y_PX = 4;

const HOP_CLEAR_PX = 6;

const ARRIVED_VX = 3;

const APPROACH_DEPTH_TILES = 5;
const APPROACH_DEPTH_CLOCK_TILES = 3;

const APPROACH_GIVE_UP_TICKS = 150;

const WALL_HOLDS = [8, 12, 18];
const WALL_STEER: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, 20],
  [0, 0],
];

const WALL_DRIFT_TICKS = [2, 4, 6, 8];

const WALL_SPREAD_TICKS = 1;

const WALL_FALL_PX = 20;

const WALL_COPY_TICKS = 140;

const WALL_MIN_VX = 3;

const WALL_SETTLE_TICKS = 300;

const ROOM_RUNS = [6, 12, 24, 48, 80];
const ROOM_BRAKE_VX = [Infinity, 4, 1.5];
const ROOM_DROP_TICKS = 260;

type Swing = { kind: "swing"; anchor: { tx: number; ty: number }; hold: number; dir: number; push: number; brake: number; direct: boolean; wall?: boolean; ropeAt?: number; preDir?: number };

const ropeFrom = (p: Swing): number => p.ropeAt ?? 0;
const ropeTo = (p: Swing): number => ropeFrom(p) + p.hold;

type Hop = { kind: "hop"; what: string; dir: number; run: number; jumpAt: number; jumpHold: number; ticks: number; room?: boolean; brakeVx?: number };

type Done = (me: TeeState, t: number) => boolean | null;

type Frame = { world: SimState | null; t: number; held: PlayerInput; pending: { at: number; input: PlayerInput }[] };
type Program = (Swing | Hop) & { startTick: number; froze: boolean };

export type CrossPhase = "approach" | "swinging" | "hopping" | "arrived" | "failed";

export class SwingCrosser {
  readonly crossing: Crossing;
  private readonly collision: Collision;
  private sim: SimWorld | null = null;
  private program: Program | null = null;
  private approachDir = 0;
  private startTick = -1;
  private lastTick = -1;

  private sent: { tick: number; input: PlayerInput }[] = [];
  private nowTick = 0;
  private cadence = 1;
  private hops = 0;
  private roomDrops = 0;
  private phaseValue: CrossPhase = "approach";
  private why = "";

  tried = 0;

  budgetMs = 0;
  private until = Infinity;

  private readonly laps = new Map<string, { at: number; tried: number }>();

  private outOfTime = false;
  stops = 0;

  private directEmpty = false;

  private ranOut = false;

  useWall = false;
  private wallThrown = false;

  private wallDropped = false;

  constructor(collision: Collision, crossing: Crossing) {
    this.collision = collision;
    this.crossing = crossing;
  }

  get phase(): CrossPhase {
    return this.phaseValue;
  }

  get done(): boolean {
    return this.phaseValue === "arrived" || this.phaseValue === "failed";
  }

  get thrown(): boolean {
    return this.program !== null;
  }

  get wallTaken(): boolean {
    return this.wallThrown;
  }

  get reason(): string {
    return this.why;
  }

  get doing(): string {
    const p = this.program;
    if (p === null) return this.phaseValue;
    if (p.kind === "hop") {
      if (p.room === true) return `${p.what}: walking to it at most ${p.run} ticks${p.brakeVx === undefined || p.brakeVx === Infinity ? "" : `, then holding back above ${p.brakeVx} px/tick`} (route 2)`;
      const push = p.dir === 0 || p.run === 0 ? "" : ` pushing ${p.dir === this.crossing.toward ? "on" : "back"} ${p.run} ticks`;
      return `${p.what}${push}${p.jumpAt < 0 ? "" : `, jump at ${p.jumpAt} for ${p.jumpHold}`}`;
    }
    if (p.wall === true) {
      const steer = p.dir === 0 ? ", swinging free" : `, pushing out${p.push > 0 ? ` and ${p.push} ticks after` : ""}`;

      const first = ropeFrom(p) > 0 ? `drifting on ${ropeFrom(p)} ticks, then ` : "";
      return `${first}rope on (${p.anchor.tx},${p.anchor.ty}) for ${p.hold} ticks${steer}, through the wall (route 2)`;
    }
    const pushed = p.direct || p.brake > 0 ? ` ${p.push} ticks` : "";
    const steer = p.dir === 0 ? ", swinging free" : `, pushing on${pushed}${p.brake > 0 ? `, then back ${p.brake}` : ""}`;
    return `rope on (${p.anchor.tx},${p.anchor.ty}) for ${p.hold} ticks${steer}${p.direct ? ", straight into the passage" : ""}`;
  }

  private arrivedAt(self: TeeState): boolean {
    if (self.frozen) return false;
    const hall = this.crossing.hall;
    if (hall !== undefined) return Math.abs(self.vel.x) <= 2 && this.supported(self) && inAnyBox(hall, tileOf(self.pos.x), tileOf(self.pos.y));
    return this.inPassage(self);
  }

  private inPassage(self: TeeState): boolean {
    return !self.frozen && Math.abs(self.vel.x) <= ARRIVED_VX && inAnyBox(this.crossing.exit, tileOf(self.pos.x), tileOf(self.pos.y));
  }

  private throughAt(self: TeeState): boolean {
    return this.arrivedAt(self) || this.inPassage(self);
  }

  private inFreeze(self: TeeState): boolean {
    for (const dx of [-14, 14]) for (const dy of [-14, 14]) if (this.collision.isFreeze(self.pos.x + dx, self.pos.y + dy)) return true;
    return false;
  }

  private nearFreeze(self: TeeState, px: number): boolean {
    const r = 14 + px;
    for (const dx of [-r, 0, r]) for (const dy of [-r, 0, r]) if (this.collision.isFreeze(self.pos.x + dx, self.pos.y + dy)) return true;
    return false;
  }

  private nearFreezeAhead(self: TeeState, px: number): boolean {
    const r = 14 + px;
    for (const dx of [0, this.crossing.toward * r]) for (const dy of [-r, 0, r]) if (this.collision.isFreeze(self.pos.x + dx, self.pos.y + dy)) return true;
    return false;
  }

  private inChamberFloor(self: TeeState): boolean {
    const ch = this.crossing.chamber;
    const tx = tileOf(self.pos.x);
    return tx >= ch.x0 && tx <= ch.x1 && tileOf(self.pos.y) > ch.y1;
  }

  private landedAt(self: TeeState): boolean {
    return !self.frozen && Math.abs(self.vel.x) <= 1 && this.supported(self) && inAnyBox(this.crossing.landing, tileOf(self.pos.x), tileOf(self.pos.y));
  }

  private wallActive(): boolean {
    return this.useWall && this.crossing.wall !== undefined;
  }

  private inRoom(self: TeeState): boolean {
    const w = this.crossing.wall;
    return w !== undefined && !self.frozen && Math.abs(self.vel.x) <= 1 && this.supported(self) && inAnyBox(w.room, tileOf(self.pos.x), tileOf(self.pos.y));
  }

  private inWallWindow(self: TeeState): boolean {
    const w = this.crossing.wall;
    if (w === undefined || self.frozen || self.vel.y < -1 || this.supported(self) || self.hookState === HOOK_GRABBED) return false;
    const ty = tileOf(self.pos.y);
    return ty <= w.lastRow && inAnyBox(this.crossing.exit, tileOf(self.pos.x), ty);
  }

  private wallStop(me: TeeState, boxes: readonly TileBox[]): boolean {
    return Math.abs(me.vel.x) <= 1 && this.supported(me) && !this.inFreeze(me) && inAnyBox(boxes, tileOf(me.pos.x), tileOf(me.pos.y));
  }

  private wallDone(me: TeeState, far: number): boolean | null {
    const w = this.crossing.wall as WallRoute;
    const tx = tileOf(me.pos.x);
    const ty = tileOf(me.pos.y);
    const out = -this.crossing.toward;

    const fromColumn = (tx - w.anchors[0].tx) * out;
    if (fromColumn < 0 && ty >= w.missRow) return null;

    if (me.frozen && fromColumn >= -2 && fromColumn <= 0 && me.vel.x * out < WALL_MIN_VX) return null;
    if ((tx - far) * out > 0) return null;
    if (this.wallStop(me, w.shelf) || this.wallStop(me, w.room)) return true;
    if (!me.frozen && Math.abs(me.vel.x) <= 1 && this.supported(me)) return null;
    return false;
  }

  private wallFar(): number {
    const w = this.crossing.wall as WallRoute;
    return this.crossing.toward < 0 ? Math.max(...w.room.map((b) => b.x1)) : Math.min(...w.room.map((b) => b.x0));
  }

  private shelfDone(me: TeeState): boolean | null {
    const w = this.crossing.wall as WallRoute;
    if (this.wallStop(me, w.shelf)) return true;
    if (!me.frozen && Math.abs(me.vel.x) <= 1 && this.supported(me) && !inAnyBox(w.room, tileOf(me.pos.x), tileOf(me.pos.y))) return null;
    return false;
  }

  step(self: TeeState, tick: number, lag = 0): PlayerInput {
    this.nowTick = tick;
    if (this.sent.length > 0 && tick < this.sent[this.sent.length - 1].tick) this.sent = [];
    const input = this.decide(self, tick, lag);
    this.sent.push({ tick, input });

    while (this.sent.length > 0 && this.sent[0].tick < tick - (lag + SPREAD_TICKS + this.cadence)) this.sent.shift();
    return input;
  }

  private decide(self: TeeState, tick: number, lag: number): PlayerInput {
    const input = emptyInput();
    if (this.done) return input;
    this.until = this.budgetMs > 0 ? Date.now() + this.budgetMs : Infinity;
    this.outOfTime = false;
    if (this.startTick < 0 || tick < this.startTick) this.startTick = tick;
    if (this.lastTick >= 0 && tick > this.lastTick) this.cadence = Math.min(4, tick - this.lastTick);
    this.lastTick = tick;
    if (!self.alive) return this.fail("died on the way", input);
    if (this.arrivedAt(self)) {
      this.phaseValue = "arrived";

      const onShelf = this.wallThrown && this.crossing.wall !== undefined && inAnyBox(this.crossing.wall.shelf, tileOf(self.pos.x), tileOf(self.pos.y));
      this.why = `through ${this.crossing.label}${onShelf ? (this.wallDropped ? ", by route 1's drop (the swing through the wall was given up)" : " and the wall (route 2)") : ""}`;
      return input;
    }
    const tx = tileOf(self.pos.x);
    const ty = tileOf(self.pos.y);
    if (self.frozen) {

      if (Math.hypot(self.vel.x, self.vel.y) < 0.5 && this.supported(self) && (this.inFreeze(self) || this.inChamberFloor(self))) return this.fail(`lies frozen at (${tx},${ty})`, input);

      if (this.program !== null) {
        this.program.froze = true;
        return this.programInput(self, this.program, tick - this.program.startTick, input);
      }
      return input;
    }

    if (this.wallActive() && this.inWallWindow(self) && !(this.program?.kind === "swing" && this.program.wall === true)) {
      const wall = this.searchWall(self, lag);
      if (wall !== null) {
        this.program = { ...wall, startTick: tick, froze: false };
        this.phaseValue = "swinging";
        this.wallThrown = true;
        this.wallDropped = false;
        return this.programInput(self, this.program, 0, input);
      }
    }

    if (this.program !== null && !this.supported(self)) {
      const p = this.program;
      const t = tick - p.startTick;
      const roped = p.kind === "swing" && t >= ropeFrom(p) && t < ropeTo(p) && self.hookState === HOOK_GRABBED;
      if (p.kind === "swing" && p.wall === true) {

        if (t > 0 && !this.works(self, p, t, lag)) {
          const again = this.searchWall(self, lag);
          if (again !== null) {
            this.program = { ...again, startTick: tick, froze: p.froze };
            this.wallDropped = false;
          } else {
            const drop = this.outOfTime ? null : this.searchDrop(self, lag);
            if (drop !== null) {
              this.program = { ...drop, startTick: tick, froze: p.froze };
              this.wallDropped = true;
            }
          }
        }
      } else if (!roped && t > 0 && !(p.kind === "hop" && p.room === true) && !this.works(self, p, t, lag)) {

        const fix = this.searchHop(self, lag, true);
        if (fix !== null) this.program = { ...fix, startTick: tick, froze: p.froze };
      }
    }
    if (this.program !== null) {
      const p = this.program;
      const t = tick - p.startTick;
      if (p.kind === "swing") {

        if (!p.froze && t > ropeFrom(p) + 12 && t < ropeTo(p) && self.hookState !== HOOK_GRABBED) this.program = null;

        else if (t >= ropeTo(p) && (this.landedAt(self) || this.inPassage(self) || (p.wall === true && this.inRoom(self)))) this.program = null;
        else if (t > ropeTo(p) + p.push + p.brake + (p.wall === true ? WALL_SETTLE_TICKS : SETTLE_TICKS)) return this.fail(`the swing ran out at (${tx},${ty})`, input);
        else if (t < ropeTo(p) + p.push + p.brake || !this.inFrom(tx, ty)) return this.programInput(self, p, t, input);

        else this.program = null;
      } else {
        const dropping = p.ticks > HOP_TICKS;

        if (p.room === true && t > p.run + 8 && this.inRoom(self)) this.program = null;
        else if (t > 4 && !dropping && (this.landedAt(self) || this.inPassage(self))) this.program = null;
        else if (t > p.ticks) return this.fail(`the ${dropping ? "drop" : "hop"} ran out at (${tx},${ty})`, input);
        else return this.programInput(self, p, t, input);
      }
    }

    if (this.wallActive() && this.inRoom(self)) {
      if (this.roomDrops >= MAX_HOPS) return this.fail(`${this.roomDrops} drops from the room floor and still at (${tx},${ty})`, input);
      const drop = this.searchRoomDrop(self, lag);
      if (drop === null && this.outOfTime) return input;
      if (drop === null) return this.fail(`no drop from the room floor at (${tx},${ty}) into the shaft`, input);
      this.roomDrops++;
      this.program = { ...drop, startTick: tick, froze: false };
      this.phaseValue = "hopping";
      return this.programInput(self, this.program, 0, input);
    }

    if (this.crossing.hall !== undefined && this.inPassage(self)) {
      const drop = this.searchDrop(self, lag);

      if (drop === null && this.outOfTime) return input;
      if (drop === null) {
        this.phaseValue = "arrived";
        this.why = `through ${this.crossing.label}, at the foot of the passage`;
        return input;
      }
      this.program = { ...drop, startTick: tick, froze: false };
      this.phaseValue = "hopping";
      return this.programInput(self, this.program, 0, input);
    }
    if (this.landedAt(self)) {
      if (this.hops >= MAX_HOPS) return this.fail(`${this.hops} hops and still at (${tx},${ty})`, input);
      const hop = this.searchHop(self, lag);
      if (hop === null && this.outOfTime) return input;
      if (hop === null) return this.fail(`no hop from (${tx},${ty}) that clears the freeze`, input);
      this.hops++;
      this.program = { ...hop, startTick: tick, froze: false };
      this.phaseValue = "hopping";
      return this.programInput(self, this.program, 0, input);
    }
    if (tick - this.startTick > APPROACH_GIVE_UP_TICKS) return this.fail("no swing through from where it got to", input);

    if (!this.nearFrom(tx, ty)) return this.fail(`off the start of it at (${tx},${ty})`, input);
    {

      const ch = this.crossing.chamber;
      const toward = this.crossing.toward;
      const nearEdge = toward < 0 ? ch.x0 : ch.x1;
      const depth = (tx - nearEdge) * -toward;
      if (tx < ch.x0 - 3 || tx > ch.x1 + 3) this.approachDir = tx < ch.x0 ? 1 : -1;
      else if (depth < (this.budgetMs > 0 ? APPROACH_DEPTH_CLOCK_TILES : APPROACH_DEPTH_TILES) && (this.supported(self) || this.approachDir === -toward)) this.approachDir = -toward;
      else this.approachDir = toward;
      if (this.approachDir === -toward) this.ranOut = true;
    }
    const found = this.searchSwing(self, lag, tick - this.startTick);
    if (found !== null) {
      this.program = { ...found, startTick: tick, froze: false };
      this.phaseValue = "swinging";
      return this.programInput(self, this.program, 0, input);
    }
    this.approachInput(input);
    return input;
  }

  private fail(why: string, input: PlayerInput): PlayerInput {
    this.phaseValue = "failed";
    this.why = why;
    this.program = null;
    return input;
  }

  private inFrom(tx: number, ty: number): boolean {
    return inAnyBox(this.crossing.from, tx, ty);
  }

  private nearFrom(tx: number, ty: number): boolean {
    for (const b of this.crossing.from) if (tx >= b.x0 - 2 && tx <= b.x1 + 2 && ty >= b.y0 - 2 && ty <= b.y1 + 2) return true;
    return false;
  }

  private supported(self: TeeState): boolean {
    return this.collision.isSolid(self.pos.x, self.pos.y + 17) || this.collision.isSolid(self.pos.x - 14, self.pos.y + 17) || this.collision.isSolid(self.pos.x + 14, self.pos.y + 17);
  }

  private approachInput(input: PlayerInput): PlayerInput {
    input.direction = this.approachDir;
    input.hook = 0;
    input.jump = 0;
    input.targetX = this.approachDir * 300;
    input.targetY = 0;
    return input;
  }

  private programInput(self: TeeState, p: Swing | Hop, t: number, input: PlayerInput): PlayerInput {
    const toward = this.crossing.toward;
    if (p.kind === "hop") {
      if (p.room === true) {

        const onFloor = this.supported(self);
        input.direction = onFloor ? (t < p.run ? p.dir : 0) : self.vel.x * p.dir > (p.brakeVx ?? Infinity) ? -p.dir : 0;
      } else input.direction = t < p.run ? p.dir : 0;
      input.jump = p.jumpAt >= 0 && t >= p.jumpAt && t < p.jumpAt + p.jumpHold ? 1 : 0;
      input.hook = 0;
      input.targetX = toward * 300;
      input.targetY = 0;
      return input;
    }

    const holding = t >= ropeFrom(p) && t < ropeTo(p);
    input.hook = holding ? 1 : 0;
    input.jump = 0;

    input.direction = t < ropeFrom(p) ? (p.preDir ?? 0) : t < ropeTo(p) + p.push ? p.dir : t < ropeTo(p) + p.push + p.brake ? -p.dir : 0;
    input.targetX = holding ? Math.round(centre(p.anchor.tx) - self.pos.x) : toward * 300;
    input.targetY = holding ? Math.round(centre(p.anchor.ty) - self.pos.y) : 0;
    if (input.targetX === 0 && input.targetY === 0) input.targetY = -1;
    return input;
  }

  private simFrom(self: TeeState): SimWorld {
    if (this.sim === null) {
      this.sim = new SimWorld(this.collision, { respawnDelayTicks: 0 });
      this.sim.addTee(0, { x: self.pos.x, y: self.pos.y });
    }
    return this.sim;
  }

  private robust(self: TeeState, p: Swing | Hop, lag: number, doneFor: (d: number) => Done, ticks: number, approaching: boolean, resume: Frame | null = null, late = SPREAD_TICKS): boolean {
    const sim = this.simFrom(self);

    const lags = [lag];
    for (let d = Math.max(0, lag - SPREAD_EARLY_TICKS); d <= lag + late; d++) if (d !== lag) lags.push(d);
    for (const d of lags) {
      sim.applyTeeState(0, { ...self, id: 0 });
      if (!this.rollout(sim, p, d, doneFor(d), ticks, approaching, 0, d === lag ? { resume } : {})) return false;
    }
    for (const [dx, dy] of [
      [-NUDGE_PX, 0],
      [NUDGE_PX, 0],
      [0, -NUDGE_Y_PX],
      [0, NUDGE_Y_PX],
    ]) {

      const x = self.pos.x + dx;
      const y = self.pos.y + dy;
      if (this.collision.isSolid(x - 14, y - 14) || this.collision.isSolid(x + 14, y - 14) || this.collision.isSolid(x - 14, y + 14) || this.collision.isSolid(x + 14, y + 14)) continue;
      sim.applyTeeState(0, { ...self, id: 0, pos: { x, y } });
      if (!this.rollout(sim, p, lag, doneFor(lag), ticks, approaching)) return false;
    }

    if (p.kind === "swing" && p.wall === true) {
      for (const wobble of [1, -1]) {
        if (wobble < 0 && lag === 0) continue;
        sim.applyTeeState(0, { ...self, id: 0 });
        if (!this.rollout(sim, p, lag, doneFor(lag), ticks, approaching, 0, { wobble })) return false;
      }
    }
    return true;
  }

  private firstThat<T>(kind: string, list: readonly T[], works: (p: T) => boolean): T | null {
    const n = list.length;
    const lap = this.laps.get(kind);
    this.laps.delete(kind);
    if (n === 0) return null;

    const from = lap === undefined ? 0 : lap.at % n;
    let tried = lap === undefined ? 0 : Math.min(lap.tried, n - 1);
    for (let k = 0; tried < n; k++, tried++) {
      const i = (from + k) % n;
      if (k > 0 && Date.now() > this.until) {
        this.laps.set(kind, { at: i, tried });
        this.outOfTime = true;
        this.stops++;
        return null;
      }
      if (works(list[i])) {
        this.laps.clear();
        return list[i];
      }
    }
    return null;
  }

  private directDone(ropeLeft: number): (d: number) => Done {
    const top = Math.min(...this.crossing.exit.map((b) => b.y0));
    return (d) => {
      const releaseAt = d + ropeLeft;
      let entered = false;
      return (me, t) => {
        if (t === 0) entered = false;
        const tx = tileOf(me.pos.x);
        const ty = tileOf(me.pos.y);
        if (!entered) {
          if (!me.frozen && this.supported(me) && (inAnyBox(this.crossing.landing, tx, ty) || t > releaseAt + 2)) return null;
          if (!me.frozen && inAnyBox(this.crossing.landing, tx, ty) && this.nearFreezeAhead(me, HOP_CLEAR_PX)) return null;
          if (!inAnyBox(this.crossing.exit, tx, ty)) {
            if (t > releaseAt + DIRECT_ENTER_TICKS) return null;

            for (const b of this.crossing.exit) if ((tx - b.x0) * this.crossing.toward > 0 && (tx - b.x1) * this.crossing.toward > 0) return null;
            return false;
          }
          entered = true;
        }
        if (me.frozen || this.nearFreeze(me, HOP_CLEAR_PX)) return null;

        if (ty > top + DIRECT_ARRIVE_DEPTH_TILES) return null;
        return Math.abs(me.vel.x) <= ARRIVED_VX;
      };
    };
  }

  private searchDirect(self: TeeState, lag: number): Swing | null {
    this.directEmpty = (this.crossing.directAnchors ?? []).length === 0;
    const toward = this.crossing.toward;

    const ch = this.crossing.chamber;
    if ((tileOf(self.pos.x) - (toward < 0 ? ch.x0 : ch.x1)) * -toward < 0) return null;
    const list: Swing[] = [];
    for (const i of this.crossing.directAnchors ?? []) {
      const anchor = this.crossing.anchors[i];
      if (anchor === undefined) continue;
      const reach = Math.hypot(centre(anchor.tx) - self.pos.x, centre(anchor.ty) - self.pos.y);
      if (reach > TUNING.hookLength + (lag + SPREAD_TICKS) * 16) continue;
      for (const hold of DIRECT_HOLDS) for (const [push, brake] of DIRECT_STEER) list.push({ kind: "swing", anchor, hold, dir: toward, push, brake, direct: true });
    }
    this.directEmpty = list.length === 0;

    const frames = new Map<string, Frame | null>();
    return this.firstThat("direct", list, (p) => {
      const key = `${p.anchor.tx},${p.anchor.ty},${p.hold}`;
      let frame = frames.get(key);
      if (frame === undefined) {
        const sim = this.simFrom(self);
        sim.applyTeeState(0, { ...self, id: 0 });
        const save: Frame = { world: null, t: -1, held: emptyInput(), pending: [] };
        this.rollout(sim, p, lag, this.directDone(p.hold)(lag), lag + p.hold + DIRECT_SAME_TICKS + 1, true, 0, { save, at: p.hold + DIRECT_SAME_TICKS });
        frame = save.t < 0 ? null : save;
        frames.set(key, frame);
      }

      if (frame === null) return false;
      return this.robust(self, p, lag, this.directDone(p.hold), lag + p.hold + DIRECT_SETTLE_TICKS, true, frame);
    });
  }

  private searchSwing(self: TeeState, lag: number, waited: number): Swing | null {
    const turnedBack = this.ranOut && this.approachDir === this.crossing.toward;
    const late = waited >= DIRECT_WAIT_TICKS || turnedBack;
    if (this.budgetMs > 0 && late) {
      const old = this.searchLanding(self, lag);
      if (old !== null || this.outOfTime) return old;
      return this.searchDirect(self, lag);
    }
    const direct = this.searchDirect(self, lag);
    if (direct !== null || this.outOfTime) return direct;
    if (!this.directEmpty && !late) return null;
    return this.searchLanding(self, lag);
  }

  private searchLanding(self: TeeState, lag: number): Swing | null {
    const toward = this.crossing.toward;
    const done = (me: TeeState): boolean => this.throughAt(me) || this.landedAt(me);
    const list: Swing[] = [];
    for (const anchor of this.crossing.anchors) {

      const reach = Math.hypot(centre(anchor.tx) - self.pos.x, centre(anchor.ty) - self.pos.y);
      if (reach > TUNING.hookLength + (lag + SPREAD_TICKS) * 16) continue;
      for (const hold of HOLDS) for (const dir of [toward, 0]) list.push({ kind: "swing", anchor, hold, dir, push: PUSH_AFTER_TICKS, brake: 0, direct: false });
    }
    return this.firstThat("swing", list, (p) => this.robust(self, p, lag, () => done, lag + p.hold + SETTLE_TICKS, true));
  }

  private searchHop(self: TeeState, lag: number, inAir = false): Hop | null {
    const toward = this.crossing.toward;
    const from = self.pos.x;
    const done = inAir
      ? (me: TeeState): boolean => this.throughAt(me) || this.landedAt(me)
      : (me: TeeState): boolean => this.throughAt(me) || (this.landedAt(me) && (me.pos.x - from) * toward > TILE_PX);
    const dirs = inAir ? [toward, 0, -toward] : [toward];
    const runs = inAir ? AIR_RUNS : HOP_RUNS;
    const jumps = inAir ? AIR_JUMP_AT : HOP_JUMP_AT;

    const passes: ((jumpAt: number) => boolean)[] = inAir ? [(j) => j < 0, (j) => j >= 0] : [() => true];
    const list: Hop[] = [];
    for (const pass of passes) {
      for (const dir of dirs) {
        for (const run of runs) {
          for (const jumpAt of jumps) {
            if (!pass(jumpAt) || jumpAt >= run) continue;
            for (const jumpHold of jumpAt < 0 ? [0] : HOP_JUMP_HOLD) list.push({ kind: "hop", what: inAir ? "in the air" : "hop", dir, run, jumpAt, jumpHold, ticks: HOP_TICKS });
          }
        }
      }
    }
    return this.firstThat(inAir ? "air" : "hop", list, (p) => this.robust(self, p, lag, () => done, lag + HOP_TICKS, false));
  }

  private searchDrop(self: TeeState, lag: number): Hop | null {
    const done = (me: TeeState): boolean => this.arrivedAt(me);
    const toward = this.crossing.toward;

    const what = this.wallActive() && !this.wallThrown ? "drop into the hall (route 2: no swing through the wall from here)" : "drop into the hall";
    const list: Hop[] = [];
    for (const run of DROP_RUNS) {
      for (const dir of run === 0 ? [0] : [-toward, toward]) list.push({ kind: "hop", what, dir, run, jumpAt: -1, jumpHold: 0, ticks: DROP_TICKS });
    }
    return this.firstThat("drop", list, (p) => this.robust(self, p, lag, () => done, lag + DROP_TICKS, false));
  }

  private searchWall(self: TeeState, lag: number): Swing | null {
    const w = this.crossing.wall as WallRoute;
    const out = -this.crossing.toward;
    const list: Swing[] = [];
    for (const anchor of w.anchors) {
      const reach = Math.hypot(centre(anchor.tx) - self.pos.x, centre(anchor.ty) - self.pos.y);
      for (const ropeAt of [0, ...WALL_DRIFT_TICKS]) {

        if (reach > TUNING.hookLength + (lag + WALL_SPREAD_TICKS + ropeAt) * WALL_FALL_PX + NUDGE_PX) continue;
        for (const hold of WALL_HOLDS) {
          for (const [dir, push] of WALL_STEER) list.push({ kind: "swing", anchor, hold, dir: dir * out, push, brake: 0, direct: false, wall: true, ropeAt, preDir: ropeAt > 0 ? -out : 0 });
        }
      }
    }
    const far = this.wallFar();
    const done: Done = (me) => this.wallDone(me, far);
    return this.firstThat("wall", list, (p) => this.robust(self, p, lag, () => done, lag + ropeTo(p) + WALL_COPY_TICKS, false, null, WALL_SPREAD_TICKS));
  }

  private searchRoomDrop(self: TeeState, lag: number): Hop | null {
    const toward = this.crossing.toward;
    const list: Hop[] = [];
    for (const brakeVx of ROOM_BRAKE_VX) {
      for (const run of ROOM_RUNS) list.push({ kind: "hop", what: "drop into the shaft", dir: toward, run, jumpAt: -1, jumpHold: 0, ticks: ROOM_DROP_TICKS, room: true, brakeVx });
    }
    const done: Done = (me) => this.shelfDone(me);
    return this.firstThat("room", list, (p) => this.robust(self, p, lag, () => done, lag + ROOM_DROP_TICKS, false));
  }

  private works(self: TeeState, p: Swing | Hop, t: number, lag: number): boolean {
    const sim = this.simFrom(self);
    sim.applyTeeState(0, { ...self, id: 0 });
    const dropping = p.kind === "hop" && p.ticks > HOP_TICKS;
    const far = p.kind === "swing" && p.wall === true ? this.wallFar() : 0;
    const done: Done =
      p.kind === "swing" && p.direct
        ? this.directDone(p.hold - t)(lag)
        : p.kind === "swing" && p.wall === true
          ? (me) => this.wallDone(me, far)
          : p.kind === "hop" && p.room === true
            ? (me) => this.shelfDone(me)
            : (me) => (dropping ? this.arrivedAt(me) : this.throughAt(me) || this.landedAt(me));
    const settle = p.kind === "swing" && p.direct ? DIRECT_SETTLE_TICKS : p.kind === "swing" && p.wall === true ? WALL_COPY_TICKS : SETTLE_TICKS;
    const ticks = p.kind === "swing" ? Math.max(lag + 20, lag + ropeTo(p) + settle - t) : Math.max(lag + 20, lag + p.ticks - t);
    return this.rollout(sim, p, lag, done, ticks, false, t);
  }

  private rollout(sim: SimWorld, p: Swing | Hop, lag: number, done: Done, ticks: number, approaching: boolean, t0 = 0, opts: { resume?: Frame | null; save?: Frame; at?: number; wobble?: number } = {}): boolean {
    this.tried++;
    let held = approaching ? this.approachInput(emptyInput()) : emptyInput();
    let pending: { at: number; input: PlayerInput }[] = [];

    if (this.sent.length > 0 && (approaching || t0 > 0 || (p.kind === "hop" && p.ticks > HOP_TICKS) || (p.kind === "swing" && p.wall === true))) {
      for (const s of this.sent) {
        const at = s.tick + lag - this.nowTick;
        if (at <= 0) held = s.input;
        else pending.push({ at, input: s.input });
      }
    }
    let from = 0;
    const { resume = null, save = null, at = -1 } = opts;
    if (resume !== null && resume.world !== null) {
      sim.restoreState(resume.world);
      held = resume.held;
      pending = resume.pending.slice();
      from = resume.t;
    }
    for (let t = from; t < ticks; t++) {
      if (save !== null && t === at) {
        save.world = sim.saveState();
        save.t = t;
        save.held = held;
        save.pending = pending.slice();
      }
      const me = sim.getTee(0);
      if (me === undefined || !me.alive) return false;
      if (t % this.cadence === 0) {
        const wobble = opts.wobble !== undefined && (t / this.cadence) % 2 === 1 ? opts.wobble : 0;
        const at = wobble === 0 ? t + lag : Math.max(t + Math.max(0, lag + wobble), pending.length > 0 ? pending[pending.length - 1].at : 0);
        pending.push({ at, input: this.programInput(me, p, t0 + t, emptyInput()) });
      }
      while (pending.length > 0 && pending[0].at <= t) held = (pending.shift() as { input: PlayerInput }).input;
      sim.setInput(0, held);
      sim.step();
      const now = sim.getTee(0);
      if (now === undefined) return false;
      const over = done(now, t);
      if (over === null) return false;

      if (t > lag + 4 && over) return true;

      if (t > lag + 8 && now.frozen && (this.inChamberFloor(now) || (Math.hypot(now.vel.x, now.vel.y) < 0.3 && this.inFreeze(now)))) return false;

      if (p.kind === "hop" && p.ticks <= HOP_TICKS && t > lag && (now.frozen || (p.what === "in the air" && this.nearFreeze(now, HOP_CLEAR_PX)))) return false;
      if (now.frozen && t > lag) {

      }
    }
    return false;
  }
}
