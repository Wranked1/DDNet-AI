import type { PlayerInput } from "../core/types.ts";
import { blankTeeState, WEAPON_HAMMER } from "../core/types.ts";
import type { TeeState } from "../core/types.ts";
import type { SimWorld } from "../core/world.ts";
import { PHYSICAL_SIZE, TUNING } from "../core/tuning.ts";
import { HOOK_IDLE } from "../core/characterCore.ts";
import { CEILING_NONE, launchFlightLandsInHazard, ROPE_CEIL_MARGIN_PX } from "./planner.ts";
import type { LaunchMemo, PlannerConfig } from "./planner.ts";

const TILE_PX = 32;

export const HAMMER_REACH_PX = PHYSICAL_SIZE * 0.75 + PHYSICAL_SIZE * 1.5;

const BELOW_SLACK_PX = 64;

const meBuf = blankTeeState();
const enBuf = blankTeeState();

export type ThreatCfg = Pick<Required<PlannerConfig>, "hammerBackTiles" | "hammerBackSepPx" | "hammerBackDelay"> & Pick<PlannerConfig, "hammerBackRopeReply" | "hammerBackJumpsAny">;

export const ROPE_REPLY_REACH_PX = TUNING.hookLength - 20;

export function ceilingRisk(world: SimWorld, me: TeeState, en: TeeState, cfg: ThreatCfg, ceiling: Uint8Array): boolean {
  if (!me.alive || me.frozen || !en.alive || en.frozen || (me.jumpsLeft !== 0 && cfg.hammerBackJumpsAny !== true)) return false;
  const tx = Math.floor(me.pos.x / TILE_PX);
  const ty = Math.floor(me.pos.y / TILE_PX);
  if (tx < 0 || ty < 0 || tx >= world.collision.width || ty >= world.collision.height) return false;
  const d = ceiling[ty * world.collision.width + tx];
  if (d === CEILING_NONE || d > cfg.hammerBackTiles) return false;
  const sep = Math.hypot(me.pos.x - en.pos.x, me.pos.y - en.pos.y);
  if (sep < cfg.hammerBackSepPx && en.pos.y >= me.pos.y - BELOW_SLACK_PX) return true;
  return cfg.hammerBackRopeReply === true && sep < ROPE_REPLY_REACH_PX && en.pos.y <= me.pos.y + BELOW_SLACK_PX;
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

export function adversaryInput(world: SimWorld, selfId: number, enemyId: number, held: PlayerInput, tick: number, cfg: ThreatCfg, launchMemo: LaunchMemo | null, ceiling: Uint8Array | null, state: AdversaryState): PlayerInput {
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
  if (sep >= HAMMER_REACH_PX || (en.reloadTicks ?? 0) !== 0) return out;
  const lands = launchMemo !== null ? launchMemo.lookup(world.collision, me.pos, en.pos, sep, me.vel) : launchFlightLandsInHazard(world.collision, me.pos, en.pos, sep, me.vel);
  if (lands !== 1) return out;
  state.pressed = true;
  state.fire = press(state.fire, true);
  const n = sep || 1;
  return { ...out, fire: state.fire, targetX: Math.round((dx / n) * 300) || 1, targetY: Math.round((dy / n) * 300), wantedWeapon: WEAPON_HAMMER + 1 };
}
