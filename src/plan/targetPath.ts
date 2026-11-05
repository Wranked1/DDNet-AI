import { vdistance } from "../core/vmath.ts";
import type { Vec2 } from "../core/vmath.ts";
import type { Collision } from "../core/collision.ts";
import type { TeeState } from "../core/types.ts";
import { findRoute } from "./route.ts";
import type { RouteStep } from "./route.ts";

export const PATH_NEAR_PX = 420;
export const PATH_REACHED_PX = 56;

export const PATH_REFRESH_TICKS = 25;
export const PATH_MIN_REFRESH_TICKS = 6;
export const PATH_MOVED_PX = 96;

export const PATH_PROGRESS_WINDOW = 10;

export type TargetRoute = { steps: RouteStep[]; at: number; target: number; to: Vec2; done: number };

export class TargetPath {
  path: TargetRoute | null = null;

  goal(collision: Collision, tick: number, self: TeeState, target: TeeState): Vec2 | null {
    const d = vdistance(self.pos, target.pos);
    if (d < PATH_NEAR_PX && this.lineIsClear(collision, self.pos, target.pos)) {
      this.path = null;
      return null;
    }
    const path = this.path;
    const age = path === null ? Infinity : tick - path.at;
    const stale =
      path === null ||
      path.target !== target.id ||
      age > PATH_REFRESH_TICKS ||
      (age >= PATH_MIN_REFRESH_TICKS && (vdistance(target.pos, path.to) > PATH_MOVED_PX || this.offPath(path, self.pos)));
    if (stale) {

      const route = findRoute(collision, self.pos, target.pos, { nearTiles: 3, partial: false, maxNodes: 4000, throughFreeze: false });
      this.path = { steps: route === null ? [] : route.steps, at: tick, target: target.id, to: { x: target.pos.x, y: target.pos.y }, done: 0 };
    }
    return this.pathAhead(this.path as TargetRoute, self.pos);
  }

  pathAhead(path: TargetRoute, at: Vec2): Vec2 | null {
    const steps = path.steps;
    let near = path.done;
    let nearD = Infinity;
    for (let i = path.done; i < Math.min(steps.length, path.done + PATH_PROGRESS_WINDOW); i++) {
      const d = vdistance(at, { x: steps[i].x * 32 + 16, y: steps[i].y * 32 + 16 });
      if (d < nearD) {
        nearD = d;
        near = i;
      }
    }
    path.done = near;
    for (let i = near; i < steps.length; i++) {
      const p = { x: steps[i].x * 32 + 16, y: steps[i].y * 32 + 16 };
      if (vdistance(at, p) > PATH_REACHED_PX) return p;
    }
    return null;
  }

  private offPath(path: TargetRoute, at: Vec2): boolean {
    const steps = path.steps;
    if (steps.length === 0) return true;
    for (let i = path.done; i < Math.min(steps.length, path.done + PATH_PROGRESS_WINDOW); i++) {
      if (vdistance(at, { x: steps[i].x * 32 + 16, y: steps[i].y * 32 + 16 }) <= PATH_MOVED_PX) return false;
    }
    return true;
  }

  private lineIsClear(collision: Collision, a: Vec2, b: Vec2): boolean {
    const steps = Math.max(1, Math.trunc(vdistance(a, b) / 16));
    for (let i = 1; i < steps; i++) {
      const x = a.x + ((b.x - a.x) * i) / steps;
      const y = a.y + ((b.y - a.y) * i) / steps;
      if (collision.isSolid(x, y) || collision.isAnyFreeze(x, y) || collision.isDeath(x, y)) return false;
    }
    return true;
  }
}
