import type { PlayerInput } from "../core/types.ts";
import { blankTeeState, WEAPON_GRENADE, WEAPON_HAMMER, WEAPON_SHOTGUN } from "../core/types.ts";
import type { TeeState } from "../core/types.ts";
import type { SimWorld } from "../core/world.ts";
import { PHYSICAL_SIZE, TUNING } from "../core/tuning.ts";
import { HOOK_IDLE, HOOK_RETRACTED, HOOK_RETRACT_END } from "../core/characterCore.ts";
import type { Collision } from "../core/collision.ts";
import type { Vec2 } from "../core/vmath.ts";
import { restsInFreeze } from "./seal.ts";
import { blastFlightLandsInHazard, CEILING_NONE, launchFlightLandsInHazard, pullFlightLandsInHazard, ROPE_CEIL_MARGIN_PX } from "./planner.ts";
import type { LaunchMemo, PlannerConfig } from "./planner.ts";

const TILE_PX = 32;

export const HAMMER_REACH_PX = PHYSICAL_SIZE * 0.75 + PHYSICAL_SIZE * 1.5;

const BELOW_SLACK_PX = 64;

const meBuf = blankTeeState();
const enBuf = blankTeeState();

export const ROPE_THREAT_MIN_PX = 70;
export const ROPE_THREAT_MAX_PX = 360;

const ROPE_MEMO_SLOTS = 1024;

export class RopeLineMemo {
  private readonly keys = new Int32Array(ROPE_MEMO_SLOTS * 2);
  private readonly values = new Uint8Array(ROPE_MEMO_SLOTS);
  private readonly epochs = new Uint32Array(ROPE_MEMO_SLOTS);
  private epoch = 1;
  private collision: Collision | null = null;
  private revision = -1;
  private readonly hook: boolean;

  constructor(hook = true) {
    this.hook = hook;
  }

  newEpoch(): void {
    this.epoch++;
  }

  clear(collision: Collision, from: Vec2, at: Vec2): boolean {
    if (this.collision !== collision || this.revision !== collision.revision) {
      this.collision = collision;
      this.revision = collision.revision;
      this.epoch++;
    }
    const fx = Math.floor(from.x / TILE_PX);
    const fy = Math.floor(from.y / TILE_PX);
    const ax = Math.floor(at.x / TILE_PX);
    const ay = Math.floor(at.y / TILE_PX);
    const a = fy * 4096 + fx;
    const b = ay * 4096 + ax;
    const k = (Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca77)) >>> 22;
    const o = k * 2;
    if (this.epochs[k] === this.epoch && this.keys[o] === a && this.keys[o + 1] === b) return this.values[k] === 1;
    const a0 = { x: fx * TILE_PX + TILE_PX / 2, y: fy * TILE_PX + TILE_PX / 2 };
    const a1 = { x: ax * TILE_PX + TILE_PX / 2, y: ay * TILE_PX + TILE_PX / 2 };
    const v = (this.hook ? collision.intersectLineHook(a0, a1) : collision.intersectLine(a0, a1)).collision === 0;
    this.keys[o] = a;
    this.keys[o + 1] = b;
    this.values[k] = v ? 1 : 0;
    this.epochs[k] = this.epoch;
    return v;
  }
}

export function inRopeThreat(collision: Collision, me: TeeState, en: TeeState, selfId: number, separation: number = Math.hypot(me.pos.x - en.pos.x, me.pos.y - en.pos.y), memo: RopeLineMemo | null = null): boolean {
  if (!me.alive || me.frozen || !en.alive || en.frozen) return false;
  if (en.hookedPlayer === selfId || en.hookState < HOOK_RETRACTED || en.hookState > HOOK_RETRACT_END) return false;
  if (separation <= ROPE_THREAT_MIN_PX || separation >= ROPE_THREAT_MAX_PX) return false;
  const dy = me.pos.y - en.pos.y;
  if (dy <= 16) {
    if (dy <= -16) return false;
    const half = PHYSICAL_SIZE / 2;
    if (collision.isSolid(me.pos.x + half, me.pos.y + half + 5) || collision.isSolid(me.pos.x - half, me.pos.y + half + 5)) return false;
  }
  return memo !== null ? memo.clear(collision, en.pos, me.pos) : collision.intersectLineHook(en.pos, me.pos).collision === 0;
}

export type ThreatCfg = Pick<Required<PlannerConfig>, "hammerBackTiles" | "hammerBackSepPx" | "hammerBackDelay"> & Pick<PlannerConfig, "hammerBackRopeReply" | "hammerBackJumpsAny" | "hammerBackSide" | "oppWeapons">;

export type RangedMemos = { pull: LaunchMemo; blast: LaunchMemo; line: RopeLineMemo };

export const SHOTGUN_REPLY_REACH_PX = TUNING.laserReach - PHYSICAL_SIZE;
export const GRENADE_REPLY_REACH_PX = 320;

export function rangedThreat(world: SimWorld, me: TeeState, en: TeeState, memos: RangedMemos | null): number {
  const w = en.activeWeapon;
  if (w !== WEAPON_SHOTGUN && w !== WEAPON_GRENADE) return -1;
  if (!world.hasWeapon(en.id, w) || !world.hitsOthers(en.id, w)) return -1;
  const sep = Math.hypot(me.pos.x - en.pos.x, me.pos.y - en.pos.y);
  if (sep >= (w === WEAPON_SHOTGUN ? SHOTGUN_REPLY_REACH_PX : GRENADE_REPLY_REACH_PX)) return -1;
  const col = world.collision;
  if (!(memos !== null ? memos.line.clear(col, en.pos, me.pos) : col.intersectLine(en.pos, me.pos).collision === 0)) return -1;
  let lands: number;
  if (w === WEAPON_SHOTGUN) lands = memos !== null ? memos.pull.lookup(col, me.pos, en.pos, sep, me.vel) : pullFlightLandsInHazard(col, me.pos, en.pos, sep, me.vel);
  else lands = memos !== null ? memos.blast.lookup(col, me.pos, en.pos, sep, me.vel) : blastFlightLandsInHazard(col, me.pos, en.pos, sep, me.vel);
  return lands === 1 ? w : -1;
}

export const ROPE_REPLY_REACH_PX = TUNING.hookLength - 20;

export function ceilingRisk(world: SimWorld, me: TeeState, en: TeeState, cfg: ThreatCfg, ceiling: Uint8Array, launchMemo: LaunchMemo | null = null, ranged: RangedMemos | null = null): boolean {
  return ceilingRiskKind(world, me, en, cfg, ceiling, launchMemo, ranged) !== 0;
}

export function ceilingRiskKind(world: SimWorld, me: TeeState, en: TeeState, cfg: ThreatCfg, ceiling: Uint8Array, launchMemo: LaunchMemo | null = null, ranged: RangedMemos | null = null): 0 | 1 | 2 | 3 {
  const kind = hammerRiskKind(world, me, en, cfg, ceiling, launchMemo);
  if (kind !== 0 || cfg.oppWeapons !== true) return kind;
  if (!me.alive || me.frozen || !en.alive || en.frozen) return 0;
  return rangedThreat(world, me, en, ranged) >= 0 ? 3 : 0;
}

function hammerRiskKind(world: SimWorld, me: TeeState, en: TeeState, cfg: ThreatCfg, ceiling: Uint8Array, launchMemo: LaunchMemo | null): 0 | 1 | 2 {
  if (!me.alive || me.frozen || !en.alive || en.frozen || (me.jumpsLeft !== 0 && cfg.hammerBackJumpsAny !== true)) return 0;
  const tx = Math.floor(me.pos.x / TILE_PX);
  const ty = Math.floor(me.pos.y / TILE_PX);
  if (tx < 0 || ty < 0 || tx >= world.collision.width || ty >= world.collision.height) return 0;
  const d = ceiling[ty * world.collision.width + tx];
  const sep = Math.hypot(me.pos.x - en.pos.x, me.pos.y - en.pos.y);
  if (d !== CEILING_NONE && d <= cfg.hammerBackTiles) {
    if (sep < cfg.hammerBackSepPx && en.pos.y >= me.pos.y - BELOW_SLACK_PX) return 1;
    if (cfg.hammerBackRopeReply === true && sep < ROPE_REPLY_REACH_PX && en.pos.y <= me.pos.y + BELOW_SLACK_PX) return 1;
  }
  if (cfg.hammerBackSide !== true || sep >= cfg.hammerBackSepPx) return 0;
  if (restsInFreeze(world.collision, me.pos, me.vel) !== 0) return 0;
  const lands = launchMemo !== null ? launchMemo.lookup(world.collision, me.pos, en.pos, sep, me.vel) : launchFlightLandsInHazard(world.collision, me.pos, en.pos, sep, me.vel);
  return lands === 1 ? 2 : 0;
}

export function ropeCeilingOver(world: SimWorld, me: TeeState, ceiling: Uint8Array): number {
  if (me.vel.y >= 0 || me.frozen || !me.alive) return 0;
  const tx = Math.floor(me.pos.x / TILE_PX);
  const ty = Math.floor(me.pos.y / TILE_PX);
  if (tx < 0 || ty < 0 || tx >= world.collision.width || ty >= world.collision.height) return 0;
  const d = ceiling[ty * world.collision.width + tx];
  if (d === CEILING_NONE) return 0;
  const gap = me.pos.y - (ty - d + 1) * TILE_PX;
  const rise = (me.vel.y * me.vel.y) / (2 * TUNING.gravity);
  return (rise - gap + ROPE_CEIL_MARGIN_PX) / ROPE_CEIL_MARGIN_PX;
}

export function hammerBackValue(hold: number, adv: number, lambda: number): number {
  return hold - lambda * Math.max(0, hold - adv);
}

export function hammerBackPick(cands: readonly { hold: number; adv: number }[], lambda: number): number {
  if (cands.length === 0) return 0;
  let top = -Infinity;
  for (const c of cands) top = Math.max(top, c.hold);
  let pick = 0;
  let pickValue = top - lambda * Math.max(0, cands[0].hold - cands[0].adv);
  for (let i = 1; i < cands.length; i++) {
    const v = hammerBackValue(cands[i].hold, cands[i].adv, lambda);
    if (v > pickValue) {
      pickValue = v;
      pick = i;
    }
  }
  return pick;
}

export type AdversaryState = { released: boolean; fire: number; pressed: boolean; threw: boolean };

export function adversaryState(held: PlayerInput): AdversaryState {
  return { released: false, fire: held.fire, pressed: false, threw: false };
}

function press(prevFire: number, on: boolean): number {
  const down = (prevFire & 1) !== 0;
  if (on) return down ? prevFire + 2 : prevFire + 1;
  return down ? prevFire + 1 : prevFire;
}

export function adversaryInput(world: SimWorld, selfId: number, enemyId: number, held: PlayerInput, tick: number, cfg: ThreatCfg, launchMemo: LaunchMemo | null, ceiling: Uint8Array | null, state: AdversaryState, memos: RangedMemos | null = null): PlayerInput {
  if (tick < cfg.hammerBackDelay) return held;
  const me = world.readTee(selfId, meBuf);
  const en = world.readTee(enemyId, enBuf);
  if (me === undefined || en === undefined || !me.alive || me.frozen || !en.alive || en.frozen) return state.released && held.hook !== 0 ? { ...held, hook: 0 } : held;
  let out = held;
  if (state.released) out = { ...held, hook: 0 };
  else if (ceiling !== null && en.hookedPlayer === selfId && ropeCeilingOver(world, me, ceiling) > 0) {
    state.released = true;
    out = { ...held, hook: 0 };
  } else if (cfg.hammerBackRopeReply === true) {
    const rx = me.pos.x - en.pos.x;
    const ry = me.pos.y - en.pos.y;
    const rd = Math.hypot(rx, ry);
    if (state.threw) out = { ...held, hook: 1, targetX: Math.round((rx / (rd || 1)) * 300) || 1, targetY: Math.round((ry / (rd || 1)) * 300) };
    else if (held.hook === 0 && en.hookState === HOOK_IDLE && en.hookedPlayer !== selfId && en.pos.y < me.pos.y - BELOW_SLACK_PX && rd < ROPE_REPLY_REACH_PX && world.collision.intersectLineHook(en.pos, me.pos).collision === 0) {
      state.threw = true;
      out = { ...held, hook: 1, targetX: Math.round((rx / (rd || 1)) * 300) || 1, targetY: Math.round((ry / (rd || 1)) * 300) };
    }
  }
  if (state.pressed) {

    state.pressed = false;
    state.fire = press(state.fire, false);
    return { ...out, fire: state.fire };
  }
  const dx = me.pos.x - en.pos.x;
  const dy = me.pos.y - en.pos.y;
  const sep = Math.hypot(dx, dy);
  const ranged = cfg.oppWeapons === true;
  const ready = (en.reloadTicks ?? 0) === 0;

  if (sep < HAMMER_REACH_PX && ready && (!ranged || world.hasWeapon(enemyId, WEAPON_HAMMER))) {
    const lands = launchMemo !== null ? launchMemo.lookup(world.collision, me.pos, en.pos, sep, me.vel) : launchFlightLandsInHazard(world.collision, me.pos, en.pos, sep, me.vel);
    if (lands === 1) {
      state.pressed = true;
      state.fire = press(state.fire, true);
      const n = sep || 1;
      return { ...out, fire: state.fire, targetX: Math.round((dx / n) * 300) || 1, targetY: Math.round((dy / n) * 300), wantedWeapon: WEAPON_HAMMER + 1 };
    }
  }
  if (!ranged || !ready) return out;

  const w = rangedThreat(world, me, en, memos);
  if (w < 0) return out;
  state.pressed = true;
  state.fire = press(state.fire, true);
  const ay = w === WEAPON_GRENADE ? dy - (TUNING.grenadeCurvature / 10000) * sep * sep : dy;
  const n = Math.hypot(dx, ay) || 1;
  return { ...out, fire: state.fire, targetX: Math.round((dx / n) * 300) || 1, targetY: Math.round((ay / n) * 300), wantedWeapon: w + 1 };
}
