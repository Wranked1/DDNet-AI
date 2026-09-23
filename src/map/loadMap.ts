import { basename, extname } from "node:path";
import { Collision } from "../core/collision.ts";
import { DataFileReader } from "./datafile.ts";

export const MAPITEMTYPE_LAYER = 5;
export const LAYERTYPE_TILES = 2;
export const TILESLAYERFLAG_GAME = 1 << 0;
export const TILESLAYERFLAG_TELE = 1 << 1;
export const TILESLAYERFLAG_SPEEDUP = 1 << 2;
export const TILESLAYERFLAG_FRONT = 1 << 3;
export const TILESLAYERFLAG_SWITCH = 1 << 4;
export const TILESLAYERFLAG_TUNE = 1 << 5;
export const TILE_AIR = 0;
export const TILE_SOLID = 1;
export const TILE_DEATH = 2;
export const TILE_NOHOOK = 3;
export const TILE_NOLASER = 4;
export const TILE_FREEZE = 9;
export const TILE_UNFREEZE = 11;
export const TILE_DFREEZE = 12;
export const TILE_DUNFREEZE = 13;

const VERSION_TEEWORLDS_TILESKIP = 4;
const TILE_SIZE = 4;

const OFF_LAYER_TYPE = 4;
const OFF_TILEMAP_VERSION = 12;
const OFF_WIDTH = 16;
const OFF_HEIGHT = 20;
const OFF_FLAGS = 24;
const OFF_DATA = 56;

const OFF_TELE = 72;
const OFF_SPEEDUP = 76;
const MIN_DDRACE_TILEMAP_SIZE = OFF_TELE + 4;
const MIN_SPEEDUP_TILEMAP_SIZE = OFF_SPEEDUP + 4;

const SPEEDUP_TILE_SIZE = 6;

const TELE_TILE_SIZE = 2;
const MIN_TILEMAP_SIZE = OFF_DATA + 4;

export type TeleLayer = {

  numbers: Uint8Array;
  types: Uint8Array;
};

export type SpeedupLayer = {
  force: Uint8Array;
  maxSpeed: Uint8Array;
  angle: Int16Array;
};

export type LoadedMap = {
  collision: Collision;
  width: number;
  height: number;
  name: string;
  tele?: TeleLayer;
  speedup?: SpeedupLayer;

  layers: { tele: boolean; speedup: boolean; front: boolean; switch: boolean; tune: boolean };
};

export function loadMapCollision(path: string): LoadedMap {
  const df = DataFileReader.open(path);
  const name = basename(path, extname(path));

  let game: { width: number; height: number; version: number; dataIndex: number } | undefined;
  let teleDataIndex = -1;
  let speedupDataIndex = -1;
  const layers = { tele: false, speedup: false, front: false, switch: false, tune: false };
  for (const layer of df.findItems(MAPITEMTYPE_LAYER)) {
    if (layer.sizeBytes < MIN_TILEMAP_SIZE) continue;
    if (layer.data.getInt32(OFF_LAYER_TYPE, true) !== LAYERTYPE_TILES) continue;
    const flags = layer.data.getInt32(OFF_FLAGS, true);
    if ((flags & TILESLAYERFLAG_TELE) !== 0) {
      layers.tele = true;

      if (layer.sizeBytes >= MIN_DDRACE_TILEMAP_SIZE) teleDataIndex = layer.data.getInt32(OFF_TELE, true);
    }
    if ((flags & TILESLAYERFLAG_SPEEDUP) !== 0) {
      layers.speedup = true;
      if (layer.sizeBytes >= MIN_SPEEDUP_TILEMAP_SIZE) speedupDataIndex = layer.data.getInt32(OFF_SPEEDUP, true);
    }
    if ((flags & TILESLAYERFLAG_FRONT) !== 0) layers.front = true;
    if ((flags & TILESLAYERFLAG_SWITCH) !== 0) layers.switch = true;
    if ((flags & TILESLAYERFLAG_TUNE) !== 0) layers.tune = true;
    if ((flags & TILESLAYERFLAG_GAME) === 0) continue;
    if (game !== undefined) continue;
    game = {
      width: layer.data.getInt32(OFF_WIDTH, true),
      height: layer.data.getInt32(OFF_HEIGHT, true),
      version: layer.data.getInt32(OFF_TILEMAP_VERSION, true),
      dataIndex: layer.data.getInt32(OFF_DATA, true),
    };
  }
  if (game === undefined) {
    throw new Error(`map '${name}': no tiles layer with TILESLAYERFLAG_GAME found`);
  }

  const { width, height } = game;
  if (width <= 0 || height <= 0) {
    throw new Error(`map '${name}': invalid game layer size ${width}x${height}`);
  }
  if (width > 100000 || height > 100000 || width * height > 50_000_000) {
    throw new Error(`map '${name}': game layer size ${width}x${height} exceeds the maximum allowed`);
  }
  const count = width * height;
  const blob = df.getData(game.dataIndex);
  const tiles = new Uint8Array(count);

  if (game.version >= VERSION_TEEWORLDS_TILESKIP) {

    const srcCount = Math.floor(blob.length / TILE_SIZE);
    let dst = 0;
    let src = 0;
    while (dst < count && src < srcCount) {
      const index = blob[src * TILE_SIZE];
      const skip = blob[src * TILE_SIZE + 2];
      for (let c = 0; c <= skip && dst < count; c++) {
        tiles[dst++] = index;
      }
      src++;
    }
    if (dst < count) {
      throw new Error(`map '${name}': game layer tile stream ended early (${dst} of ${count} tiles)`);
    }
  } else {
    if (blob.length < count * TILE_SIZE) {
      throw new Error(`map '${name}': game layer data too small (${blob.length} bytes for ${width}x${height})`);
    }
    for (let i = 0; i < count; i++) {
      tiles[i] = blob[i * TILE_SIZE];
    }
  }

  let tele: TeleLayer | undefined;
  if (teleDataIndex >= 0) {
    const raw = df.getData(teleDataIndex);

    if (raw.length >= count * TELE_TILE_SIZE) {
      const numbers = new Uint8Array(count);
      const types = new Uint8Array(count);
      for (let i = 0; i < count; i++) {
        numbers[i] = raw[i * TELE_TILE_SIZE];
        types[i] = raw[i * TELE_TILE_SIZE + 1];
      }
      tele = { numbers, types };
    }
  }

  let speedup: SpeedupLayer | undefined;
  if (speedupDataIndex >= 0) {
    const raw = df.getData(speedupDataIndex);
    if (raw.length >= count * SPEEDUP_TILE_SIZE) {
      const force = new Uint8Array(count);
      const maxSpeed = new Uint8Array(count);
      const angle = new Int16Array(count);
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      for (let i = 0; i < count; i++) {
        force[i] = raw[i * SPEEDUP_TILE_SIZE];
        maxSpeed[i] = raw[i * SPEEDUP_TILE_SIZE + 1];
        angle[i] = view.getInt16(i * SPEEDUP_TILE_SIZE + 4, true);
      }
      speedup = { force, maxSpeed, angle };
    }
  }

  return { collision: new Collision(width, height, tiles, tele, speedup), width, height, name, tele, speedup, layers };
}

export function tileCounts(map: LoadedMap): Map<number, number> {
  const counts = new Map<number, number>();
  for (const t of map.collision.tiles) {
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return counts;
}
