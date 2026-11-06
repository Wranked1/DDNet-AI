import type { Vec2 } from "../core/vmath.ts";
import { closestPointOnLineOrNull, vdistance } from "../core/vmath.ts";
import type { Collision } from "../core/collision.ts";
import { PHYSICAL_SIZE, TILE_NOHOOK, TILE_SOLID } from "../core/tuning.ts";
import type { TuningParams } from "../core/tuning.ts";
import type { WorldEvent } from "../core/types.ts";
import { WEAPON_LASER, blankTeeState } from "../core/types.ts";
import type { EntityWorld } from "../core/projectile.ts";
import { Laser } from "../core/projectile.ts";
import type { SimWorld } from "../core/world.ts";
import { NO_TEAM, spikeTeamPoints } from "../core/fng.ts";
import type { FngRules } from "../core/fng.ts";
import type { HazardField } from "./planner.ts";

const TILE_PX = 32;

const NEAR_TILES = 20;

export function fieldNearness(field: HazardField, x: number, y: number): number {
  const tx = Math.floor(x / TILE_PX);
  const ty = Math.floor(y / TILE_PX);
  if (tx < 0 || ty < 0 || tx >= field.width || ty >= field.height) return 0;
  const d = field.dist[ty * field.width + tx];
  if (d >= NEAR_TILES) return 0;
  return (NEAR_TILES - d) / NEAR_TILES;
}

function spikeBfs(collision: Collision, isSource: (spike: number) => boolean): HazardField {
  const { width, height, tiles } = collision;
  const dist = new Int32Array(width * height).fill(0x3fffffff);
  const queue: number[] = [];
  for (let i = 0; i < width * height; i++) {
    const s = collision.spikeAtIndex(i);
    if (s !== 0 && isSource(s)) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const idx = queue[qi];
    const x = idx % width;
    const y = (idx - x) / width;
    const d = dist[idx];
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      const nt = tiles[ni];
      if (nt === TILE_SOLID || nt === TILE_NOHOOK) continue;
      if (dist[ni] > d + 1) {
        dist[ni] = d + 1;
        queue.push(ni);
      }
    }
  }
  return { width, height, dist };
}

export type FngSpikeFields = {

  good: HazardField;

  byValue: { points: number; field: HazardField }[];

  wrong: HazardField;

  anyGood: boolean;
};

const fieldCache = new WeakMap<Collision, { revision: number; fields: Map<string, FngSpikeFields> }>();

export function fngSpikeFields(collision: Collision, team: number, rules: Readonly<FngRules>): FngSpikeFields {
  let cached = fieldCache.get(collision);
  if (cached === undefined || cached.revision !== collision.revision) {
    cached = { revision: collision.revision, fields: new Map() };
    fieldCache.set(collision, cached);
  }
  const perMap = cached.fields;
  const key = `${team}|${rules.teamplay ? 1 : 0}|${rules.scoreNormal},${rules.scoreTeam},${rules.scoreGold},${rules.scoreGreen},${rules.scorePurple},${rules.scoreWrong}`;
  const hit = perMap.get(key);
  if (hit !== undefined) return hit;
  let anyGood = false;
  const values = new Set<number>();
  const good = spikeBfs(collision, (s) => {
    const pts = spikeTeamPoints(s, team, rules);
    if (pts > 0) {
      anyGood = true;
      values.add(pts);
    }
    return pts > 0;
  });
  const byValue = [...values].sort((a, b) => b - a).map((points) => ({ points, field: spikeBfs(collision, (s) => spikeTeamPoints(s, team, rules) === points) }));
  const wrong = spikeBfs(collision, (s) => spikeTeamPoints(s, team, rules) < 0);
  const fields = { good, byValue, wrong, anyGood };
  perMap.set(key, fields);
  return fields;
}

export function fallsInto(collision: Collision, x: number, y: number, rows: number): number {
  for (let k = 0; k <= rows; k++) {
    const yy = y + k * TILE_PX;
    if (collision.isSolid(x, yy)) return 0;
    if (collision.isDeath(x, yy)) {
      const s = collision.spikeAt(x, yy);
      return s !== 0 ? s : -1;
    }
  }
  return 0;
}

function grounded(collision: Collision, x: number, y: number): boolean {
  const h = PHYSICAL_SIZE / 2;
  return collision.isSolid(x + h, y + h + 5) || collision.isSolid(x - h, y + h + 5);
}

const FALL_ROWS = 48;

const FALL_LEAD_TICKS = 4;

export function goodPull(fields: FngSpikeFields, x: number, y: number): number {
  const top = fields.byValue.length > 0 ? fields.byValue[0].points : 1;
  let best = 0;
  for (const v of fields.byValue) {
    const n = (fieldNearness(v.field, x, y) * v.points) / top;
    if (n > best) best = n;
  }
  return best;
}

export function laserLine(collision: Collision, from: Vec2, to: Vec2, reach: number): boolean {
  if (vdistance(from, to) > reach) return false;
  return collision.intersectLine(from, to).collision === 0;
}

class GhostWorld implements EntityWorld {
  tick = 0;
  readonly collision: Collision;
  readonly svHit = true;
  private readonly at: Vec2;
  private readonly vel: Vec2;
  private readonly radius: number;
  hitTick = -1;

  constructor(collision: Collision, at: Vec2, vel: Vec2, radius: number) {
    this.collision = collision;
    this.at = at;
    this.vel = vel;
    this.radius = radius;
  }

  private ghost(): Vec2 {
    return { x: this.at.x + this.vel.x * this.tick, y: this.at.y + this.vel.y * this.tick };
  }

  isAlive(): boolean {
    return true;
  }

  teePos(): Vec2 {
    return this.ghost();
  }

  intersectCharacter(pos0: Vec2, pos1: Vec2, radius: number): { id: number; pos: Vec2 } | null {
    const g = this.ghost();
    const ip = closestPointOnLineOrNull(pos0, pos1, g);
    if (ip === null || vdistance(ip, g) >= this.radius + radius) return null;
    this.hitTick = this.tick;
    return { id: 1, pos: ip };
  }

  findCharactersInRadius(): number[] {
    return [];
  }

  applyForce(): void {}
  setVelocity(): void {}
  unfreeze(): void {}

  hitsOthers(): boolean {
    return true;
  }

  explosionStrength(): number {
    return 0;
  }
}

export function fngBounceAims(collision: Collision, from: Vec2, en: { pos: Vec2; vel: Vec2 }, tuning: TuningParams, count: number, steps = 120, margin = 6): number[] {
  if (count <= 0) return [];
  const radius = Math.max(4, PHYSICAL_SIZE - margin);
  const hits: { angle: number; tick: number }[] = [];
  const flags: (number | null)[] = [];
  const events: WorldEvent[] = [];
  const maxTicks = Math.ceil(((tuning.laserBounceNum + 1) * tuning.laserBounceDelay * 50) / 1000) + 2;
  for (let i = 0; i < steps; i++) {
    const angle = -Math.PI + (2 * Math.PI * i) / steps;
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };

    const direct = new GhostWorld(collision, en.pos, en.vel, radius);
    const laser = new Laser(0, 0, WEAPON_LASER, from, dir, tuning.laserReach, 0, tuning);
    events.length = 0;
    laser.doBounce(direct, events, 0);
    if (direct.hitTick >= 0) {
      flags.push(null);
      continue;
    }
    let met: number | null = null;
    for (let t = 1; t <= maxTicks && !laser.markedForDestroy; t++) {
      direct.tick = t;
      laser.tick(direct, events);
      if (direct.hitTick >= 0) {
        met = direct.hitTick;
        break;
      }
    }
    flags.push(met);
  }

  const start = flags.indexOf(null);
  if (start < 0) return [];
  let i = 1;
  while (i < steps) {
    if (flags[(start + i) % steps] === null) {
      i++;
      continue;
    }
    let n = 0;
    let soonest = Infinity;
    while (i + n < steps && flags[(start + i + n) % steps] !== null) {
      soonest = Math.min(soonest, flags[(start + i + n) % steps] as number);
      n++;
    }
    const mid = (start + i + (n - 1) / 2) % steps;
    hits.push({ angle: -Math.PI + (2 * Math.PI * mid) / steps, tick: soonest });
    i += n;
  }
  hits.sort((a, b) => a.tick - b.tick);
  return hits.slice(0, count).map((h) => h.angle);
}

export type FngRoll = {

  enemyDeadValue: number;
};

export type FngScoreCtx = {
  rules: Readonly<FngRules>;
  team: number;

  all: HazardField;
  good: FngSpikeFields;
  reach: number;
  frozenWeight: number;
  selfFreezeBias: number;
  selfHazardCost: number;
  selfHazardThreshold: number;
  hookHoldWeight: number;
  distanceWeight: number;
  standoffPx: number;
  wastedHammer: number;
  sacrificeWeight: number;
  spikePull: number;
  wrongPull: number;
  laserExposure: number;
  meltWeight: number;

  approachWeight: number;

  dropCost: number;
};

const SWING_SPOT_PX = 34;

const APPROACH_TILES = 20;

const meBuf = blankTeeState();
const enBuf = blankTeeState();

export function enemyDeathValue(world: SimWorld, selfId: number, e: { by: number; spike?: number; frozen?: boolean }, ctx: FngScoreCtx): number {
  if (e.spike === undefined || e.spike === 0 || e.frozen !== true) return 0.1;
  const ours = e.by === selfId || (ctx.rules.teamplay && ctx.team !== NO_TEAM && world.fngTeamOf(e.by) === ctx.team);
  if (!ours) return 0.1;
  return spikeTeamPoints(e.spike, ctx.team, ctx.rules) / 10;
}

export function scoreTickFng(world: SimWorld, selfId: number, enemyId: number, events: readonly WorldEvent[], ctx: FngScoreCtx, roll: FngRoll): number {
  const me = world.readTee(selfId, meBuf);
  const en = world.readTee(enemyId, enBuf);
  if (me === undefined || en === undefined) return -1000;
  let s = 0;
  for (const e of events) {
    if (e.kind === "death" && e.id === enemyId) {
      const v = ctx.sacrificeWeight * enemyDeathValue(world, selfId, e, ctx);
      roll.enemyDeadValue = v;
      s += v;
    } else if (e.kind === "death" && e.id === selfId) s -= 15;
    else if (e.kind === "hammerFire" && e.from === selfId && e.hits === 0) s -= ctx.wastedHammer;
    else if (e.kind === "hammerHit" && e.from === selfId && e.melt === true) s += ctx.meltWeight;
  }
  if (!en.alive) s += roll.enemyDeadValue;
  if (!me.alive) {
    s -= 15;
    return s;
  }
  if (me.frozen) {
    s -= ctx.frozenWeight * ctx.selfFreezeBias;
    s -= ctx.spikePull * 0.5 * fieldNearness(ctx.all, me.pos.x, me.pos.y);
  } else {
    const meNear = fieldNearness(ctx.all, me.pos.x, me.pos.y);
    if (meNear > ctx.selfHazardThreshold) s -= ctx.selfHazardCost * (meNear - ctx.selfHazardThreshold);
    if (ctx.dropCost > 0 && !grounded(world.collision, me.pos.x, me.pos.y) && fallsInto(world.collision, me.pos.x + me.vel.x * FALL_LEAD_TICKS, me.pos.y, FALL_ROWS) !== 0) s -= ctx.dropCost;
  }
  if (en.alive) {
    if (en.frozen) {
      s += ctx.frozenWeight;
      s += ctx.spikePull * goodPull(ctx.good, en.pos.x, en.pos.y);
      s -= ctx.wrongPull * fieldNearness(ctx.good.wrong, en.pos.x, en.pos.y);
      if (!grounded(world.collision, en.pos.x, en.pos.y)) {
        const lands = fallsInto(world.collision, en.pos.x + en.vel.x * FALL_LEAD_TICKS, en.pos.y, FALL_ROWS);
        const pts = lands > 0 ? spikeTeamPoints(lands, ctx.team, ctx.rules) : 0;
        if (pts > 0) s += ctx.spikePull * 0.5;
        else if (pts < 0) s -= ctx.wrongPull;
      }
    } else if (!me.frozen && ctx.laserExposure > 0 && world.fngLaserReloadOf(enemyId) <= 2 && world.fngInvincibleOf(selfId) === 0 && laserLine(world.collision, en.pos, me.pos, ctx.reach)) {
      s -= ctx.laserExposure;
    }
    if (me.hookedPlayer === enemyId) s += ctx.hookHoldWeight;
    if (en.hookedPlayer === selfId) s -= ctx.hookHoldWeight * 0.75;
    if (en.frozen && ctx.approachWeight > 0) {
      const right = goodPull(ctx.good, en.pos.x + TILE_PX, en.pos.y);
      const left = goodPull(ctx.good, en.pos.x - TILE_PX, en.pos.y);
      const push = right > left ? 1 : left > right ? -1 : 0;
      const dx = me.pos.x - (en.pos.x - push * SWING_SPOT_PX);
      const dy = me.pos.y - en.pos.y;
      const tiles = Math.max(0, Math.sqrt(dx * dx + dy * dy) - TILE_PX / 2) / TILE_PX;
      s += ctx.approachWeight * Math.max(0, APPROACH_TILES - tiles);
    } else {
      const separation = vdistance(me.pos, en.pos);
      s -= ctx.distanceWeight * (Math.max(0, separation - ctx.standoffPx) / TILE_PX);
    }
  }
  return s;
}
