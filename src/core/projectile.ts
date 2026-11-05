import type { Vec2 } from "./vmath.ts";
import { clamp, roundToInt, vadd, vdistance, vlength, vmul, vnormalize, vsub } from "./vmath.ts";
import type { Collision } from "./collision.ts";
import { SERVER_TICK_SPEED, TUNING } from "./tuning.ts";
import type { TuningParams } from "./tuning.ts";
import type { WorldEvent } from "./types.ts";
import { WEAPON_GRENADE, WEAPON_GUN, WEAPON_LASER, WEAPON_SHOTGUN } from "./types.ts";

export interface EntityWorld {
  readonly tick: number;
  readonly collision: Collision;
  readonly svHit: boolean;
  isAlive(id: number): boolean;
  teePos(id: number): Vec2 | undefined;

  intersectCharacter(pos0: Vec2, pos1: Vec2, radius: number, excludeId: number, onlyId: number): { id: number; pos: Vec2 } | null;

  findCharactersInRadius(pos: Vec2, radius: number): number[];

  applyForce(id: number, force: Vec2): void;

  setVelocity(id: number, vel: Vec2): void;
  unfreeze(id: number): void;

  hitsOthers(owner: number, weapon: number): boolean;

  explosionStrength(owner: number): number;
}

const STACKED_SHOTGUN_BUG_SPEED: Vec2 = { x: -2147483648.0, y: -2147483648.0 };

function calcPos(pos: Vec2, dir: Vec2, curvature: number, speed: number, time: number): Vec2 {
  const t = time * speed;
  return { x: pos.x + dir.x * t, y: pos.y + dir.y * t + (curvature / 10000) * (t * t) };
}

function weaponCurvatureSpeed(type: number, tuning: TuningParams): { curvature: number; speed: number } {
  switch (type) {
    case WEAPON_GRENADE:
      return { curvature: tuning.grenadeCurvature, speed: tuning.grenadeSpeed };
    case WEAPON_GUN:
      return { curvature: tuning.gunCurvature, speed: tuning.gunSpeed };
    default:
      return { curvature: 0, speed: 0 };
  }
}

export function isGameLayerClipped(pos: Vec2, collision: Collision): boolean {
  const tx = Math.trunc(roundToInt(pos.x) / 32);
  const ty = Math.trunc(roundToInt(pos.y) / 32);
  return tx < -200 || tx > collision.width + 200 || ty < -200 || ty > collision.height + 200;
}

export function createExplosion(world: EntityWorld, pos: Vec2, owner: number, weapon: number, noDamage: boolean, events: WorldEvent[]): void {
  events.push({ kind: "explosion", pos: { ...pos }, owner });

  const radius = 135.0;
  const innerRadius = 48.0;
  for (const id of world.findCharactersInRadius(pos, radius)) {
    const p = world.teePos(id);
    if (!p) continue;
    const diff = vsub(p, pos);
    const len = vlength(diff);
    const forceDir = len ? vnormalize(diff) : { x: 0, y: 1 };
    const falloff = 1 - clamp((len - innerRadius) / (radius - innerRadius), 0, 1);
    const strength = world.explosionStrength(owner);
    const dmg = strength * falloff;
    if (Math.trunc(dmg) === 0) continue;

    if (world.hitsOthers(owner, WEAPON_GRENADE) || noDamage || owner === id) {
      world.applyForce(id, vmul(forceDir, dmg * 2));
    }
  }
}

export type ProjectileState2 = {
  id: number; type: number; owner: number; posX: number; posY: number; dirX: number; dirY: number;
  startTick: number; lifeSpan: number; explosive: boolean; markedForDestroy: boolean;

  tuneZone?: number;
};

export type LaserState2 = {
  id: number; owner: number; type: number; posX: number; posY: number; dirX: number; dirY: number;
  energy: number; bounces: number; evalTick: number; zeroEnergyBounceInLastTick: boolean; markedForDestroy: boolean;
  tuneZone?: number;

  fromX?: number; fromY?: number;
};

export class Projectile {
  readonly id: number;
  readonly type: number;
  readonly owner: number;
  readonly pos: Vec2;
  readonly dir: Vec2;
  readonly startTick: number;
  readonly explosive: boolean;
  readonly vel: Vec2;
  lifeSpan: number;
  markedForDestroy = false;

  readonly tuneZone: number;
  private readonly tuning: TuningParams;

  constructor(id: number, type: number, owner: number, pos: Vec2, dir: Vec2, startTick: number, lifeSpan: number, explosive: boolean, tuneZone = 0, tuning: TuningParams = TUNING) {
    this.id = id;
    this.type = type;
    this.owner = owner;
    this.pos = { ...pos };
    this.dir = { ...dir };
    this.startTick = startTick;
    this.lifeSpan = lifeSpan;
    this.explosive = explosive;
    this.tuneZone = tuneZone;
    this.tuning = tuning;
    const { speed } = weaponCurvatureSpeed(type, tuning);
    this.vel = vmul(dir, speed);
  }

  saveState(): ProjectileState2 {
    return { id: this.id, type: this.type, owner: this.owner, posX: this.pos.x, posY: this.pos.y, dirX: this.dir.x, dirY: this.dir.y, startTick: this.startTick, lifeSpan: this.lifeSpan, explosive: this.explosive, markedForDestroy: this.markedForDestroy, tuneZone: this.tuneZone };
  }

  static fromState(world: { readonly collision: Collision }, st: ProjectileState2): Projectile {
    const zone = st.tuneZone ?? 0;
    const p = new Projectile(st.id, st.type, st.owner, { x: st.posX, y: st.posY }, { x: st.dirX, y: st.dirY }, st.startTick, st.lifeSpan, st.explosive, zone, world.collision.tuningOfZone(zone));
    p.markedForDestroy = st.markedForDestroy;
    return p;
  }

  posAtTick(tick: number): Vec2 {
    const { curvature, speed } = weaponCurvatureSpeed(this.type, this.tuning);
    const time = (tick - this.startTick) / SERVER_TICK_SPEED;
    return calcPos(this.pos, this.dir, curvature, speed, time);
  }

  tick(world: EntityWorld, events: WorldEvent[]): void {
    const prevPos = this.posAtTick(world.tick - 1);
    const curPos = this.posAtTick(world.tick);

    const { collision, outPos } = world.collision.intersectLine(prevPos, curPos);
    const collide = collision !== 0;

    let colPos = outPos;

    let targetId = -1;
    if (world.hitsOthers(this.owner, WEAPON_GRENADE)) {
      const hit = world.intersectCharacter(prevPos, outPos, 6.0, this.owner, -1);
      if (hit) {
        targetId = hit.id;
        colPos = hit.pos;
      }
    }

    if (this.lifeSpan > -1) this.lifeSpan--;

    if (this.owner >= 0 && !world.isAlive(this.owner)) {
      this.markedForDestroy = true;
      return;
    }

    const outOfBounds = isGameLayerClipped(curPos, world.collision);
    if (targetId !== -1 || collide || outOfBounds) {
      if (this.explosive) {
        createExplosion(world, colPos, this.owner, this.type, this.owner === -1, events);
        this.markedForDestroy = true;
        return;
      }

      this.markedForDestroy = true;
      return;
    }

    if (this.lifeSpan === -1) {
      if (this.explosive) {
        createExplosion(world, colPos, this.owner, this.type, this.owner === -1, events);
      }
      this.markedForDestroy = true;
    }
  }
}

export class Laser {
  readonly id: number;
  readonly owner: number;
  readonly type: number;
  pos: Vec2;
  dir: Vec2;

  from: Vec2;
  energy: number;
  bounces = 0;
  evalTick = 0;
  zeroEnergyBounceInLastTick = false;
  markedForDestroy = false;

  readonly tuneZone: number;
  private readonly tuning: TuningParams;

  saveState(): LaserState2 {
    return { id: this.id, owner: this.owner, type: this.type, posX: this.pos.x, posY: this.pos.y, dirX: this.dir.x, dirY: this.dir.y, energy: this.energy, bounces: this.bounces, evalTick: this.evalTick, zeroEnergyBounceInLastTick: this.zeroEnergyBounceInLastTick, markedForDestroy: this.markedForDestroy, tuneZone: this.tuneZone, fromX: this.from.x, fromY: this.from.y };
  }

  static fromState(world: { readonly collision: Collision }, st: LaserState2): Laser {
    const zone = st.tuneZone ?? 0;
    const l = new Laser(st.id, st.owner, st.type, { x: st.posX, y: st.posY }, { x: st.dirX, y: st.dirY }, st.energy, zone, world.collision.tuningOfZone(zone));
    l.pos = { x: st.posX, y: st.posY };
    l.dir = { x: st.dirX, y: st.dirY };
    l.energy = st.energy;
    l.bounces = st.bounces;
    l.evalTick = st.evalTick;
    l.zeroEnergyBounceInLastTick = st.zeroEnergyBounceInLastTick;
    l.markedForDestroy = st.markedForDestroy;
    l.from = { x: st.fromX ?? st.posX, y: st.fromY ?? st.posY };
    return l;
  }

  constructor(id: number, owner: number, type: number, pos: Vec2, dir: Vec2, startEnergy: number, tuneZone = 0, tuning: TuningParams = TUNING) {
    this.tuneZone = tuneZone;
    this.tuning = tuning;
    this.id = id;
    this.owner = owner;
    this.type = type;
    this.pos = { ...pos };
    this.dir = { ...dir };
    this.from = { ...pos };
    this.energy = startEnergy;
  }

  private hitCharacter(world: EntityWorld, from: Vec2, to: Vec2, events: WorldEvent[]): boolean {
    const dontHitSelf = this.bounces === 0;
    const excludeId = dontHitSelf ? this.owner : -1;
    const onlyId = world.hitsOthers(this.owner, this.type) ? -1 : this.owner;
    const hit = world.intersectCharacter(from, to, 0, excludeId, onlyId);
    if (!hit) return false;

    this.pos = { ...hit.pos };
    this.energy = -1;

    if (this.type === WEAPON_SHOTGUN) {
      const strength = this.tuning.shotgunStrength;
      const hitPos = world.teePos(hit.id);
      if (hitPos && (hitPos.x !== from.x || hitPos.y !== from.y)) {
        world.applyForce(hit.id, vmul(vnormalize(vsub(from, hitPos)), strength));
      } else if (hitPos) {

        world.setVelocity(hit.id, STACKED_SHOTGUN_BUG_SPEED);
      }
    } else if (this.type === WEAPON_LASER) {
      world.unfreeze(hit.id);
    }

    events.push({ kind: "laserHit", from: this.owner, to: hit.id, weapon: this.type });
    return true;
  }

  doBounce(world: EntityWorld, events: WorldEvent[], now: number = world.tick): void {
    this.evalTick = now;
    if (this.energy < 0) {
      this.markedForDestroy = true;
      return;
    }

    const rayStart = { ...this.pos };

    this.from = rayStart;
    const to = vadd(rayStart, vmul(this.dir, this.energy));
    const { collision, outBeforePos } = world.collision.intersectLine(rayStart, to);

    if (collision !== 0) {

      const hitTo = outBeforePos;
      if (!this.hitCharacter(world, rayStart, hitTo, events)) this.bounceAt(world.collision, rayStart, hitTo);
    } else {
      if (!this.hitCharacter(world, rayStart, to, events)) {
        this.pos = { ...to };
        this.energy = -1;
      }
    }
  }

  private bounceAt(collision: Collision, rayStart: Vec2, hitTo: Vec2): void {
    this.pos = { ...hitTo };

    const tempPos: Vec2 = { ...this.pos };
    const tempVel: Vec2 = vmul(this.dir, 4.0);
    collision.movePoint(tempPos, tempVel, 1.0, null);
    this.pos = tempPos;
    this.dir = vnormalize(tempVel);

    const dist = vdistance(rayStart, this.pos);
    if (dist === 0 && this.zeroEnergyBounceInLastTick) {
      this.energy = -1;
    } else {
      this.energy -= dist + this.tuning.laserBounceCost;
    }
    this.zeroEnergyBounceInLastTick = dist === 0;

    this.bounces++;
    if (this.bounces > this.tuning.laserBounceNum) this.energy = -1;
  }

  traceWalls(collision: Collision): void {
    if (this.energy < 0) return;
    const rayStart = { ...this.pos };
    this.from = rayStart;
    const to = vadd(rayStart, vmul(this.dir, this.energy));
    const hit = collision.intersectLine(rayStart, to);
    if (hit.collision !== 0) this.bounceAt(collision, rayStart, hit.outBeforePos);
    else {
      this.pos = { ...to };
      this.energy = -1;
    }
  }

  tick(world: EntityWorld, events: WorldEvent[]): void {
    const delayTicks = (SERVER_TICK_SPEED * this.tuning.laserBounceDelay) / 1000.0;
    if (world.tick - this.evalTick > delayTicks) {
      this.doBounce(world, events);
    }
  }
}
