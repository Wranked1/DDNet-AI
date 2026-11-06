import { SERVER_TICK_SPEED, TILE_AIR, TILE_DEATH, TILE_NOHOOK, TILE_SOLID } from "./tuning.ts";

export const FNG_SPIKE_GOLD = 7;
export const FNG_SPIKE_NORMAL = 8;
export const FNG_SPIKE_RED = 9;
export const FNG_SPIKE_BLUE = 10;
export const FNG_SPIKE_GREEN = 14;
export const FNG_SPIKE_PURPLE = 15;

export const FNG_SCORE_RED = 11;
export const FNG_SCORE_BLUE = 12;

export const FNG_ENTITY_OFFSET = 191;
export const FNG_ENTITY_SPAWN = 192;
export const FNG_ENTITY_SPAWN_RED = 193;
export const FNG_ENTITY_SPAWN_BLUE = 194;

export const TEAM_RED = 0;
export const TEAM_BLUE = 1;
export const NO_TEAM = -1;

export function isFngSpike(tile: number): boolean {
  return tile === FNG_SPIKE_GOLD || tile === FNG_SPIKE_NORMAL || tile === FNG_SPIKE_RED || tile === FNG_SPIKE_BLUE || tile === FNG_SPIKE_GREEN || tile === FNG_SPIKE_PURPLE;
}

export function fngGameTile(tile: number): number {
  if (tile === TILE_SOLID || tile === TILE_DEATH || tile === TILE_NOHOOK) return tile;
  if (isFngSpike(tile)) return TILE_DEATH;
  if (tile > FNG_ENTITY_OFFSET) return tile;
  return TILE_AIR;
}

export type FngRules = {

  hitFreezeTicks: number;

  wrongSpikeFreezeTicks: number;

  meltTicks: number;

  thawInvincibleTicks: number;

  spawnInvincibleTicks: number;
  spawnNoFireTicks: number;

  hammerScaleX: number;
  hammerScaleY: number;
  meltScaleX: number;
  meltScaleY: number;

  laserFireDelayTicks: number;
  laserBounceNum: number;

  killTakeOverTicks: number;

  teamplay: boolean;

  scoreNormal: number;
  scoreTeam: number;
  scoreGold: number;
  scoreGreen: number;
  scorePurple: number;
  scoreWrong: number;
};

export const FNG2_RULES: Readonly<FngRules> = Object.freeze({
  hitFreezeTicks: 10 * SERVER_TICK_SPEED,
  wrongSpikeFreezeTicks: 5 * SERVER_TICK_SPEED,
  meltTicks: 3 * SERVER_TICK_SPEED,
  thawInvincibleTicks: SERVER_TICK_SPEED / 2,
  spawnInvincibleTicks: Math.trunc(SERVER_TICK_SPEED * 0.35),
  spawnNoFireTicks: SERVER_TICK_SPEED * 0.35,
  hammerScaleX: 3.2,
  hammerScaleY: 1.2,
  meltScaleX: 0.5,
  meltScaleY: 0.5,
  laserFireDelayTicks: Math.trunc((800 * SERVER_TICK_SPEED) / 1000),
  laserBounceNum: 1,
  killTakeOverTicks: 13,
  teamplay: true,
  scoreNormal: 5,
  scoreTeam: 10,
  scoreGold: 10,
  scoreGreen: 10,
  scorePurple: 10,
  scoreWrong: -2,
});

export function spikeTeam(spike: number): number {
  if (spike === FNG_SPIKE_RED) return TEAM_RED;
  if (spike === FNG_SPIKE_BLUE) return TEAM_BLUE;
  return NO_TEAM;
}

export function isWrongSpike(spike: number, killerTeam: number, rules: Readonly<FngRules>): boolean {
  if (!rules.teamplay || killerTeam === NO_TEAM) return false;
  const owner = spikeTeam(spike);
  return owner !== NO_TEAM && owner !== killerTeam;
}

export function spikeTeamPoints(spike: number, killerTeam: number, rules: Readonly<FngRules>): number {
  switch (spike) {
    case FNG_SPIKE_NORMAL:
      return rules.scoreNormal;
    case FNG_SPIKE_GOLD:
      return rules.scoreGold;
    case FNG_SPIKE_GREEN:
      return rules.scoreGreen;
    case FNG_SPIKE_PURPLE:
      return rules.scorePurple;
    case FNG_SPIKE_RED:
    case FNG_SPIKE_BLUE:
      return isWrongSpike(spike, killerTeam, rules) ? rules.scoreWrong : rules.scoreTeam;
    default:
      return 0;
  }
}

export const SPIKE_PRIORITY: readonly number[] = [FNG_SPIKE_NORMAL, FNG_SPIKE_RED, FNG_SPIKE_BLUE, FNG_SPIKE_GOLD, FNG_SPIKE_GREEN, FNG_SPIKE_PURPLE];
