import type { Collision } from "../core/collision.ts";
import { Laser } from "../core/projectile.ts";
import type { LaserState2 } from "../core/projectile.ts";
import { SERVER_TICK_SPEED } from "../core/tuning.ts";
import { WEAPON_LASER, WEAPON_SHOTGUN } from "../core/types.ts";
import type { Vec2 } from "../core/vmath.ts";

export type LaserSnap = { id: number; owner: number; type: number; from: Vec2; to: Vec2; startTick: number };

export type LaserSeed = { state: LaserState2; ageTicks: number };

const MATCH_PX = 4;

const WIRE_HALF_PX = 0.5;

const MAX_TRACE = 64;

type Beam = { owner: number; type: number; first: number; step: number; laser: Laser; next: number; dead: boolean };

export class LaserTracker {
  private readonly beams = new Map<number, Beam>();

  update(collision: Collision, lasers: readonly LaserSnap[], tick: number, attackTickOf: (owner: number) => number | undefined): LaserSeed[] {
    const out: LaserSeed[] = [];
    const seen = new Set<number>();
    for (const l of lasers) {
      if ((l.type !== WEAPON_SHOTGUN && l.type !== WEAPON_LASER) || l.owner < 0) continue;
      seen.add(l.id);
      const shot = attackTickOf(l.owner) === l.startTick;
      let beam = this.beams.get(l.id);

      if (beam !== undefined && (beam.owner !== l.owner || beam.type !== l.type || l.startTick < beam.first || (shot && l.startTick !== beam.first && (l.startTick - beam.first) % beam.step !== 0))) beam = undefined;
      if (beam === undefined) {
        if (!shot) {
          this.beams.delete(l.id);
          continue;
        }
        const zone = collision.tuned ? collision.tuneZoneAt(l.from) : 0;
        const tuning = collision.tuningOfZone(zone);
        const laser = new Laser(0, l.owner, l.type, l.from, { x: 1, y: 0 }, tuning.laserReach, zone, tuning);
        const step = Math.floor((SERVER_TICK_SPEED * tuning.laserBounceDelay) / 1000) + 1;
        beam = { owner: l.owner, type: l.type, first: l.startTick, step, laser, next: l.startTick, dead: false };
        this.beams.set(l.id, beam);
      }
      if (beam.dead) continue;

      for (let n = 0; beam.next < l.startTick && n < MAX_TRACE && beam.laser.energy >= 0; n++) {
        beam.laser.traceWalls(collision);
        beam.next += beam.step;
      }
      if (beam.next === l.startTick && beam.laser.energy >= 0) {

        const fx = l.from.x + WIRE_HALF_PX;
        const fy = l.from.y + WIRE_HALF_PX;
        const dx = l.to.x + WIRE_HALF_PX - fx;
        const dy = l.to.y + WIRE_HALF_PX - fy;
        const len = Math.hypot(dx, dy);

        if (beam.next !== beam.first && Math.hypot(beam.laser.pos.x - fx, beam.laser.pos.y - fy) > MATCH_PX) {
          beam.dead = true;
          continue;
        }
        beam.laser.pos = { x: fx, y: fy };
        if (len > 0) beam.laser.dir = { x: dx / len, y: dy / len };
        beam.laser.traceWalls(collision);
        beam.next += beam.step;
        if (Math.hypot(beam.laser.pos.x - fx - dx, beam.laser.pos.y - fy - dy) > MATCH_PX) beam.dead = true;
      } else if (beam.next !== l.startTick + beam.step) beam.dead = true;
      if (beam.dead || beam.laser.energy < 0) continue;
      out.push({ state: beam.laser.saveState(), ageTicks: Math.max(0, tick - l.startTick) });
    }
    for (const id of this.beams.keys()) if (!seen.has(id)) this.beams.delete(id);
    return out;
  }

  clear(): void {
    this.beams.clear();
  }
}
