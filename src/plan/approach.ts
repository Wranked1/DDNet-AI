import type { Collision } from "../core/collision.ts";
import { blankTeeState } from "../core/types.ts";
import type { TeeState } from "../core/types.ts";
import { PHYSICAL_SIZE, TUNING } from "../core/tuning.ts";
import { vdistance } from "../core/vmath.ts";
import type { Vec2 } from "../core/vmath.ts";
import { standable } from "../bot/wayblock.ts";
import { hazardField } from "./planner.ts";
import { findRoute } from "./route.ts";
import type { RouteResult, RouteStep } from "./route.ts";
import { ROPE_THREAT_MAX_PX, ROPE_THREAT_MIN_PX, inRopeThreat } from "./threat.ts";
import { PATH_MIN_REFRESH_TICKS, PATH_MOVED_PX, PATH_PROGRESS_WINDOW, PATH_REFRESH_TICKS, TargetPath } from "./targetPath.ts";
import type { TargetRoute } from "./targetPath.ts";

export const LANE_MIN_PX = TUNING.hookLength + PHYSICAL_SIZE + 2 + 10;
export const LANE_MAX_PX = 560;

export const LANE_RELEASE_PX = ROPE_THREAT_MAX_PX + 24;
export const LANE_REARM_PX = 580;

export const LANE_SAMPLE = 8;
export const LANE_STEP_ROUTES = 2;

export const LANE_HAZARD_TILES = 3;

export const LANE_ARRIVED_PX = 48;

export const LANE_EPISODE_TICKS = 150;

const DWELL_MAX = 250;

const BELOW_COST = 2;
const ROPE_STEP_COST = 3;

const NO_PICK_COOLDOWN_TICKS = 50;

export type LaneOpts = {

  temperature: number;

  dwell: number;
};

export type LaneRng = { nextFloat(): number };

const standCache = new WeakMap<Collision, { tx: number; ty: number }[]>();
function standTiles(col: Collision): { tx: number; ty: number }[] {
  const hit = standCache.get(col);
  if (hit !== undefined) return hit;
  const field = hazardField(col);
  const tiles: { tx: number; ty: number }[] = [];
  for (let ty = 0; ty < col.height; ty++) {
    for (let tx = 0; tx < col.width; tx++) {
      if (standable(col, tx, ty) && field.dist[ty * field.width + tx] >= LANE_HAZARD_TILES) tiles.push({ tx, ty });
    }
  }
  standCache.set(col, tiles);
  return tiles;
}

const centre = (t: number): number => t * 32 + 16;

type Pick = { ring: { tx: number; ty: number }[]; cursor: number; best: Vec2 | null; bestRoute: RouteResult; bestV: number; him: TeeState };

export class ApproachLanes {

  anchor: Vec2 | null = null;

  picks = 0;
  attempts = 0;
  routes = 0;
  private readonly rng: LaneRng;
  private readonly walker = new TargetPath();
  private targetId = -1;
  private anchorFor: Vec2 = { x: 0, y: 0 };
  private path: TargetRoute | null = null;
  private pick: Pick | null = null;
  private pickedAt = -1e9;
  private arrivedAt = -1;
  private episodeAt = -1;
  private dwell = 0;

  private resting = false;
  private needClose = false;
  private closeSeen = false;
  private noPickUntil = -1e9;

  constructor(rng: LaneRng) {
    this.rng = rng;
  }

  reset(): void {
    this.anchor = null;
    this.path = null;
    this.pick = null;
    this.arrivedAt = -1;
    this.episodeAt = -1;
    this.resting = false;
    this.needClose = false;
    this.closeSeen = false;
    this.noPickUntil = -1e9;
    this.pickedAt = -1e9;
    this.targetId = -1;
  }

  goal(collision: Collision, tick: number, self: TeeState, target: TeeState, opts: LaneOpts): Vec2 | undefined {
    if (!(opts.temperature > 0)) {
      this.reset();
      return undefined;
    }

    if (!standCache.has(collision)) {
      standTiles(collision);
      return undefined;
    }
    const sep = vdistance(self.pos, target.pos);
    if (target.id !== this.targetId) {

      this.anchor = null;
      this.path = null;
      this.pick = null;
      this.arrivedAt = -1;
      this.needClose = false;

      this.resting = this.targetId >= 0 && sep <= LANE_REARM_PX;
      this.targetId = target.id;
    }
    if (this.resting) {
      if (sep <= LANE_REARM_PX) {
        this.closeSeen = true;
        return undefined;
      }
      if (this.needClose && !this.closeSeen) return undefined;
      this.resting = false;
      this.needClose = false;
      this.closeSeen = false;
    }

    if (!self.alive || !target.alive || self.frozen || target.frozen || self.hookedPlayer === target.id || target.hookedPlayer === self.id) return this.release();
    if (sep < LANE_RELEASE_PX) return this.release();
    if (this.episodeAt >= 0 && tick - this.episodeAt > LANE_EPISODE_TICKS) {
      this.release();
      this.needClose = true;
      this.closeSeen = false;
      return undefined;
    }
    if (this.pick !== null) {
      this.stepPick(collision, tick, self, opts);
    } else if (this.anchor === null) {
      if (tick < this.noPickUntil || tick - this.pickedAt < PATH_MIN_REFRESH_TICKS) return undefined;
      this.startPick(collision, tick, target);
      this.stepPick(collision, tick, self, opts);
    } else if (vdistance(target.pos, this.anchorFor) > PATH_MOVED_PX && tick - this.pickedAt >= PATH_MIN_REFRESH_TICKS) {

      this.startPick(collision, tick, target);
      this.stepPick(collision, tick, self, opts);
    }
    if (this.anchor === null) return undefined;
    const anchor = this.anchor;
    if (this.arrivedAt < 0 && vdistance(self.pos, anchor) < LANE_ARRIVED_PX) this.arrivedAt = tick;
    if (this.arrivedAt >= 0) {
      if (tick - this.arrivedAt >= this.dwell) return this.release();
      return anchor;
    }

    const path = this.path;
    const age = path === null ? Infinity : tick - path.at;
    if (path === null || age > PATH_REFRESH_TICKS || (age >= PATH_MIN_REFRESH_TICKS && this.offPath(path, self.pos))) {
      this.routes++;
      const route = findRoute(collision, self.pos, anchor, { nearTiles: 1, partial: false, maxNodes: 4000, throughFreeze: false });

      if (route === null) return this.release();
      this.path = { steps: route.steps, at: tick, target: -2, to: anchor, done: 0 };
    }
    return this.walker.pathAhead(this.path as TargetRoute, self.pos) ?? anchor;
  }

  private release(): undefined {
    this.anchor = null;
    this.path = null;
    this.pick = null;
    this.arrivedAt = -1;
    this.episodeAt = -1;
    this.resting = true;
    return undefined;
  }

  private offPath(path: TargetRoute, at: Vec2): boolean {
    if (path.steps.length === 0) return true;
    for (let i = path.done; i < Math.min(path.steps.length, path.done + PATH_PROGRESS_WINDOW); i++) {
      if (vdistance(at, { x: centre(path.steps[i].x), y: centre(path.steps[i].y) }) <= PATH_MOVED_PX) return false;
    }
    return true;
  }

  private ropeSteps(collision: Collision, steps: readonly RouteStep[], him: TeeState): number {
    const me: TeeState = { ...blankTeeState(), id: -2, alive: true };
    let n = 0;
    for (const st of steps) {
      me.pos = { x: centre(st.x), y: centre(st.y) };
      if (inRopeThreat(collision, me, him, -2)) {
        n++;
        continue;
      }
      if (st.kind === "walk") continue;
      const d = vdistance(me.pos, him.pos);
      if (d > ROPE_THREAT_MIN_PX && d < ROPE_THREAT_MAX_PX && me.pos.y - him.pos.y > -16 && collision.intersectLineHook(him.pos, me.pos).collision === 0) n++;
    }
    return n;
  }

  private startPick(collision: Collision, tick: number, target: TeeState): void {
    this.attempts++;
    this.pickedAt = tick;
    if (this.episodeAt < 0) this.episodeAt = tick;
    this.anchorFor = { x: target.pos.x, y: target.pos.y };
    const ring = standTiles(collision).filter((s) => {
      const d = Math.hypot(centre(s.tx) - target.pos.x, centre(s.ty) - target.pos.y);
      return d >= LANE_MIN_PX && d <= LANE_MAX_PX;
    });
    const n = Math.min(LANE_SAMPLE, ring.length);
    for (let i = 0; i < n; i++) {
      const j = i + Math.min(ring.length - i - 1, Math.floor(this.rng.nextFloat() * (ring.length - i)));
      const t = ring[i];
      ring[i] = ring[j];
      ring[j] = t;
    }
    ring.length = n;
    this.pick = { ring, cursor: 0, best: null, bestRoute: null, bestV: Infinity, him: { ...blankTeeState(), id: target.id, alive: true, pos: { x: target.pos.x, y: target.pos.y } } };
  }

  private stepPick(collision: Collision, tick: number, self: TeeState, opts: LaneOpts): void {
    const pick = this.pick;
    if (pick === null) return;
    for (let k = 0; k < LANE_STEP_ROUTES && pick.cursor < pick.ring.length; k++) {
      const s = pick.ring[pick.cursor++];
      const at = { x: centre(s.tx), y: centre(s.ty) };
      this.routes++;
      const route = findRoute(collision, self.pos, at, { nearTiles: 1, partial: false, maxNodes: 4000, throughFreeze: false });
      if (route === null) continue;
      const below = Math.max(0, (at.y - pick.him.pos.y) / 32);
      const cost = route.cost + BELOW_COST * below + ROPE_STEP_COST * this.ropeSteps(collision, route.steps, pick.him);
      const u = Math.max(1e-9, this.rng.nextFloat());
      const v = cost - opts.temperature * -Math.log(-Math.log(u));
      if (v < pick.bestV) {
        pick.bestV = v;
        pick.best = at;
        pick.bestRoute = route;
      }
    }
    if (pick.cursor < pick.ring.length) return;
    this.pick = null;
    if (pick.best === null || pick.bestRoute === null) {
      this.anchor = null;
      this.path = null;
      this.arrivedAt = -1;
      this.noPickUntil = tick + NO_PICK_COOLDOWN_TICKS;
      return;
    }
    this.anchor = pick.best;
    this.path = { steps: pick.bestRoute.steps, at: tick, target: -2, to: pick.best, done: 0 };
    this.arrivedAt = -1;
    this.dwell = Math.floor(this.rng.nextFloat() * (Math.max(0, Math.min(DWELL_MAX, opts.dwell)) + 1));
    this.picks++;
  }
}
