/* Map item layouts and the draw order follow DDNet's src/game/mapitems.h and
   src/game/map/render_layer.cpp (zlib license).
   Copyright (C) 2007-2014 Magnus Auvinen (Teeworlds); Copyright (C) DDRace and
   DDNet contributors. This is an altered version, not the original software. */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflate, deflateSync } from "node:zlib";
import { DataFileReader } from "../map/datafile.ts";

const MAPITEMTYPE_IMAGE = 2;
const MAPITEMTYPE_ENVELOPE = 3;
const MAPITEMTYPE_GROUP = 4;
const MAPITEMTYPE_LAYER = 5;
const MAPITEMTYPE_ENVPOINTS = 6;

const ENVELOPE_VERSION_BEZIER = 3;
const ENVPOINT_BYTES = 24;
const ENVPOINT_BEZIER_BYTES = 88;
const MAX_ENV_POINTS = 100_000;
const LAYERTYPE_TILES = 2;
const LAYERTYPE_QUADS = 3;
const LAYERFLAG_DETAIL = 1;
const TILESLAYERFLAG_GAME = 1;
const TILESLAYERFLAG_TELE = 2;
const TILESLAYERFLAG_SPEEDUP = 4;
const TILESLAYERFLAG_FRONT = 8;
const TILESLAYERFLAG_SWITCH = 16;
const TILESLAYERFLAG_TUNE = 32;
const VERSION_TEEWORLDS_TILESKIP = 4;
const QUAD_BYTES = 152;
const MAX_TILES = 50_000_000;

export const QUAD_REC = 38;

export type SceneTiles = {
  kind: "tiles";
  id: number;
  w: number;
  h: number;
  color: [number, number, number, number];
  image: number;
  detail: boolean;

  role: "visual" | "game" | "front" | SpecialRole;

  env: number;
  envOff: number;
};

export type SceneQuads = { kind: "quads"; id: number; image: number; detail: boolean; quads: number[] };

export type SceneEnvelope = { c: number; p: number[] };
export type SceneGroup = {
  ox: number;
  oy: number;
  px: number;
  py: number;
  clip: [number, number, number, number] | null;
  layers: (SceneTiles | SceneQuads)[];
};
export type SceneImage = { name: string; w: number; h: number; external: boolean };
export type Scene = { name: string; groups: SceneGroup[]; images: SceneImage[]; envelopes: SceneEnvelope[] };

export type ParsedScene = {
  scene: Scene;

  tiles: Map<number, Uint8Array>;

  png: (index: number) => Promise<Buffer | null>;
};

function cstr(buf: Buffer): string {
  const end = buf.indexOf(0);
  return buf.toString("utf8", 0, end < 0 ? buf.length : end);
}

function i32(d: DataView, off: number, size: number, fallback = 0): number {
  return off + 4 <= size ? d.getInt32(off, true) : fallback;
}

export function unpackTiles(blob: Uint8Array, count: number, skipFormat: boolean): Uint8Array {
  const out = new Uint8Array(count * 2);
  if (skipFormat) {
    let dst = 0;
    for (let src = 0; src + 4 <= blob.length && dst < count; src += 4) {
      const skip = blob[src + 2];
      for (let c = 0; c <= skip && dst < count; c++, dst++) {
        out[dst * 2] = blob[src];
        out[dst * 2 + 1] = blob[src + 1];
      }
    }
  } else {
    const n = Math.min(count, Math.floor(blob.length / 4));
    for (let i = 0; i < n; i++) {
      out[i * 2] = blob[i * 4];
      out[i * 2 + 1] = blob[i * 4 + 1];
    }
  }
  return out;
}

export type SpecialRole = "tele" | "speedup" | "switch";
export const SPECIAL_FIELDS: Record<SpecialRole, number> = { tele: 2, switch: 4, speedup: 5 };

const SPECIAL_LAYERS: { flag: number; role: SpecialRole; off: number; offV2: number; size: number }[] = [
  { flag: TILESLAYERFLAG_TELE, role: "tele", off: 72, offV2: 60, size: 2 },
  { flag: TILESLAYERFLAG_SPEEDUP, role: "speedup", off: 76, offV2: 64, size: 6 },
  { flag: TILESLAYERFLAG_SWITCH, role: "switch", off: 84, offV2: 72, size: 4 },
];

export function packSpecialTiles(raw: Uint8Array, count: number, role: SpecialRole): Uint8Array {

  const size = role === "tele" ? 2 : role === "switch" ? 4 : 6;
  const at: number[] = [];
  if (role === "tele") {
    for (let i = 0, o = 0; i < count; i++, o += 2) if ((raw[o] | raw[o + 1]) !== 0) at.push(i);
  } else if (role === "switch") {
    for (let i = 0, o = 0; i < count; i++, o += 4) if ((raw[o] | raw[o + 1] | raw[o + 2] | raw[o + 3]) !== 0) at.push(i);
  } else {
    for (let i = 0, o = 0; i < count; i++, o += 6) if ((raw[o] | raw[o + 1] | raw[o + 2] | raw[o + 4] | raw[o + 5]) !== 0) at.push(i);
  }
  const nf = SPECIAL_FIELDS[role];

  const out = new Uint8Array(at.length * (5 + nf));
  let w = 0;
  let last = -1;
  for (const i of at) {
    let gap = i - last - 1;
    last = i;
    while (gap >= 0x80) {
      out[w++] = (gap & 0x7f) | 0x80;
      gap >>>= 7;
    }
    out[w++] = gap;
    const o = i * size;
    if (role === "tele") {
      out[w++] = raw[o + 1];
      out[w++] = raw[o];
    } else if (role === "switch") {
      out[w++] = raw[o + 1];
      out[w++] = raw[o + 2];
      out[w++] = raw[o];
      out[w++] = raw[o + 3];
    } else {
      out[w++] = raw[o + 2];
      out[w++] = raw[o];
      out[w++] = raw[o + 1];
      out[w++] = raw[o + 4];
      out[w++] = raw[o + 5];
    }
  }
  return out.slice(0, w);
}

export function encodePng(w: number, h: number, rgba: Uint8Array, level = 1): Buffer {
  return pngFrom(w, h, deflateSync(pngRows(w, h, rgba), { level }));
}

export async function encodePngAsync(w: number, h: number, rgba: Uint8Array, level = 1, sliceMs = 4): Promise<Buffer> {
  const rows = await pngRowsSliced(w, h, rgba, sliceMs);
  return await new Promise((resolve, reject) => {
    deflate(rows, { level }, (err, out) => (err ? reject(err) : resolve(pngFrom(w, h, out))));
  });
}

const loopTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

async function pngRowsSliced(w: number, h: number, rgba: Uint8Array, sliceMs: number): Promise<Buffer> {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  let t0 = performance.now();
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
    if ((y & 31) === 31 && performance.now() - t0 >= sliceMs) {
      await loopTurn();
      t0 = performance.now();
    }
  }
  return raw;
}

function pngRows(w: number, h: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return raw;
}

function pngFrom(w: number, h: number, idat: Buffer): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function readerFor(bytes: Uint8Array): DataFileReader {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    return Reflect.construct(DataFileReader as unknown as new (b: Buffer) => DataFileReader, [buf]) as DataFileReader;
  } catch (err) {

    if (!(err instanceof TypeError)) throw err;
  }

  const dir = mkdtempSync(join(tmpdir(), "ddnet-ai-scene-"));
  try {
    const tmp = join(dir, "m.map");
    writeFileSync(tmp, buf);
    return DataFileReader.open(tmp);
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {

    }
  }
}

function* sceneSteps(bytes: Uint8Array, name: string, cacheDir: string | null): Generator<void, ParsedScene> {

  const df = readerFor(bytes);

  const images: SceneImage[] = [];
  const imageData: ({ w: number; h: number; data: number; rgb: boolean } | null)[] = [];
  for (const it of df.findItems(MAPITEMTYPE_IMAGE)) {
    const d = it.data;
    const n = it.sizeBytes;
    const version = i32(d, 0, n);
    const w = i32(d, 4, n);
    const h = i32(d, 8, n);
    const external = i32(d, 12, n) !== 0;
    const nameIdx = i32(d, 16, n, -1);
    const dataIdx = i32(d, 20, n, -1);

    const rgb = version >= 2 && i32(d, 24, n, 1) === 0;
    let imgName = "";
    try {
      imgName = nameIdx >= 0 ? cstr(df.getData(nameIdx)) : "";
    } catch {
      imgName = "";
    }
    images.push({ name: imgName, w, h, external });
    imageData.push(external || dataIdx < 0 || w <= 0 || h <= 0 || w * h > 64_000_000 ? null : { w, h, data: dataIdx, rgb });
  }

  const envelopes = parseEnvelopes(df);
  yield;

  const layerItems = df.findItems(MAPITEMTYPE_LAYER);
  const tiles = new Map<number, Uint8Array>();

  const lastOf = new Map<SpecialRole, number>();
  for (const g of df.findItems(MAPITEMTYPE_GROUP)) {
    const start = i32(g.data, 20, g.sizeBytes);
    const num = i32(g.data, 24, g.sizeBytes);
    for (let li = start; li < start + num && li < layerItems.length; li++) {
      if (li < 0) continue;
      const L = layerItems[li];
      if (i32(L.data, 4, L.sizeBytes) !== LAYERTYPE_TILES) continue;
      const tflags = i32(L.data, 24, L.sizeBytes);
      if ((tflags & TILESLAYERFLAG_GAME) !== 0) continue;
      const sp = SPECIAL_LAYERS.find((k) => (tflags & k.flag) !== 0);
      if (sp !== undefined) lastOf.set(sp.role, li);
    }
  }
  const groups: SceneGroup[] = [];
  for (const g of df.findItems(MAPITEMTYPE_GROUP)) {
    const d = g.data;
    const n = g.sizeBytes;
    const version = i32(d, 0, n);
    const useClip = version >= 2 && i32(d, 28, n) !== 0;
    const group: SceneGroup = {
      ox: i32(d, 4, n),
      oy: i32(d, 8, n),
      px: i32(d, 12, n, 100),
      py: i32(d, 16, n, 100),
      clip: useClip ? [i32(d, 32, n), i32(d, 36, n), i32(d, 40, n), i32(d, 44, n)] : null,
      layers: [],
    };
    const start = i32(d, 20, n);
    const num = i32(d, 24, n);
    for (let li = start; li < start + num && li < layerItems.length; li++) {
      if (li < 0) continue;
      const L = layerItems[li];
      const ld = L.data;
      const ln = L.sizeBytes;
      const type = i32(ld, 4, ln);
      const detail = (i32(ld, 8, ln) & LAYERFLAG_DETAIL) !== 0;
      if (type === LAYERTYPE_TILES) {
        const tv = i32(ld, 12, ln);
        const w = i32(ld, 16, ln);
        const h = i32(ld, 20, ln);
        const tflags = i32(ld, 24, ln);
        if (w <= 0 || h <= 0 || w * h > MAX_TILES) continue;
        const sp = (tflags & TILESLAYERFLAG_GAME) === 0 ? SPECIAL_LAYERS.find((k) => (tflags & k.flag) !== 0) : undefined;
        if (sp !== undefined) {

          if (lastOf.get(sp.role) !== li) continue;
          const idx = i32(ld, tv <= 2 ? sp.offV2 : sp.off, ln, -1);
          if (idx < 0) continue;
          let raw: Buffer;
          try {
            raw = df.getData(idx);
          } catch {
            continue;
          }

          if (raw.length < w * h * sp.size) continue;
          tiles.set(li, packSpecialTiles(raw, w * h, sp.role));
          group.layers.push({ kind: "tiles", id: li, w, h, color: [255, 255, 255, 255], image: -1, detail, role: sp.role, env: -1, envOff: 0 });
          yield;
          continue;
        }

        if ((tflags & TILESLAYERFLAG_TUNE) !== 0) continue;
        const role = (tflags & TILESLAYERFLAG_GAME) !== 0 ? "game" : (tflags & TILESLAYERFLAG_FRONT) !== 0 ? "front" : "visual";

        const dataIdx = role === "front" ? i32(ld, 80, ln, -1) : i32(ld, 56, ln, -1);
        if (dataIdx < 0) continue;
        let blob: Buffer;
        try {
          blob = df.getData(dataIdx);
        } catch {
          continue;
        }
        tiles.set(li, unpackTiles(blob, w * h, tv >= VERSION_TEEWORLDS_TILESKIP));
        const color: [number, number, number, number] = [i32(ld, 28, ln, 255), i32(ld, 32, ln, 255), i32(ld, 36, ln, 255), i32(ld, 40, ln, 255)];
        const env = role === "visual" ? i32(ld, 44, ln, -1) : -1;
        group.layers.push({
          kind: "tiles",
          id: li,
          w,
          h,
          color,
          image: role === "visual" ? i32(ld, 52, ln, -1) : -1,
          detail,
          role,
          env: env >= 0 && env < envelopes.length ? env : -1,
          envOff: i32(ld, 48, ln, 0),
        });
        yield;
      } else if (type === LAYERTYPE_QUADS) {
        const numQuads = i32(ld, 16, ln);
        const dataIdx = i32(ld, 20, ln, -1);
        const image = i32(ld, 24, ln, -1);
        if (numQuads <= 0 || dataIdx < 0) continue;
        let blob: Buffer;
        try {
          blob = df.getData(dataIdx);
        } catch {
          continue;
        }
        const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
        const quads: number[] = [];
        const envOk = (e: number): number => (e >= 0 && e < envelopes.length ? e : -1);
        for (let q = 0; q < numQuads && (q + 1) * QUAD_BYTES <= blob.length; q++) {
          const b = q * QUAD_BYTES;
          for (let p = 0; p < 4; p++) {
            quads.push(dv.getInt32(b + p * 8, true) / 1024, dv.getInt32(b + p * 8 + 4, true) / 1024);
          }
          for (let c = 0; c < 16; c++) quads.push(dv.getInt32(b + 40 + c * 4, true));
          for (let t = 0; t < 8; t++) quads.push(dv.getInt32(b + 104 + t * 4, true) / 1024);

          quads.push(dv.getInt32(b + 32, true) / 1024, dv.getInt32(b + 36, true) / 1024);
          quads.push(envOk(dv.getInt32(b + 136, true)), dv.getInt32(b + 140, true), envOk(dv.getInt32(b + 144, true)), dv.getInt32(b + 148, true));
        }
        group.layers.push({ kind: "quads", id: li, image, detail, quads });
        yield;
      }
    }
    groups.push(group);
  }

  const pngCache = new Map<number, Promise<Buffer | null>>();
  let queue: Promise<unknown> = Promise.resolve();
  const png = (index: number): Promise<Buffer | null> => {
    const hit = pngCache.get(index);
    if (hit) return hit;
    const job = queue
      .then(loopTurn)
      .then(() => imageFor(index))
      .catch(() => null);
    queue = job;
    pngCache.set(index, job);
    return job;
  };
  let cacheKey: string | null = null;
  let touched = false;
  const cachedFile = (index: number): string | null => {
    if (cacheDir === null) return null;
    cacheKey ??= `${(crc32(bytes) >>> 0).toString(16).padStart(8, "0")}-${bytes.length}`;
    return join(cacheDir, cacheKey, `${index}.png`);
  };
  const imageFor = async (index: number): Promise<Buffer | null> => {
    const info = imageData[index];
    if (!info) return null;
    const file = cachedFile(index);
    if (file !== null) {
      try {
        const kept = await readFile(file);
        if (pngOf(kept, info.w, info.h)) {

          if (!touched) {
            touched = true;
            const now = new Date();
            await utimes(join(file, ".."), now, now).catch(() => {});
          }
          return kept;
        }
      } catch {

      }
    }
    const made = await encodeImage(info);
    if (made !== null && file !== null && cacheDir !== null) await keepPng(cacheDir, file, made);
    return made;
  };
  const encodeImage = async (info: { w: number; h: number; data: number; rgb: boolean }): Promise<Buffer | null> => {
    try {
      const raw = await readerFor(bytes).getDataAsync(info.data);
      let rgba: Uint8Array = raw;
      if (info.rgb) {
        const n = info.w * info.h;
        if (raw.length < n * 3) return null;
        rgba = new Uint8Array(n * 4);
        let t0 = performance.now();
        for (let i = 0; i < n; i++) {
          rgba[i * 4] = raw[i * 3];
          rgba[i * 4 + 1] = raw[i * 3 + 1];
          rgba[i * 4 + 2] = raw[i * 3 + 2];
          rgba[i * 4 + 3] = 255;
          if ((i & 0xffff) === 0xffff && performance.now() - t0 >= 4) {
            await loopTurn();
            t0 = performance.now();
          }
        }
      }
      if (rgba.length >= info.w * info.h * 4) return await encodePngAsync(info.w, info.h, rgba);
    } catch {
      return null;
    }
    return null;
  };

  return { scene: { name, groups, images, envelopes }, tiles, png };
}

function parseEnvelopes(df: DataFileReader): SceneEnvelope[] {
  const items = df.findItems(MAPITEMTYPE_ENVELOPE);
  if (items.length === 0) return [];
  const bezierUpstream = items.some((e) => i32(e.data, 0, e.sizeBytes) >= ENVELOPE_VERSION_BEZIER);
  const size = bezierUpstream ? ENVPOINT_BEZIER_BYTES : ENVPOINT_BYTES;
  const ptsItem = df.findItems(MAPITEMTYPE_ENVPOINTS)[0];
  const maxPts = ptsItem === undefined ? 0 : Math.min(MAX_ENV_POINTS, Math.floor(ptsItem.sizeBytes / size));
  const out: SceneEnvelope[] = [];
  for (const e of items) {
    const d = e.data;
    const n = e.sizeBytes;
    const channels = Math.max(0, Math.min(4, i32(d, 4, n)));
    const start = Math.max(0, Math.min(maxPts, i32(d, 8, n)));
    const num = Math.max(0, Math.min(maxPts - start, i32(d, 12, n)));
    const p: number[] = [];
    if (ptsItem !== undefined) {
      const pv = ptsItem.data;
      for (let k = 0; k < num; k++) {
        const o = (start + k) * size;
        p.push(pv.getInt32(o, true), pv.getInt32(o + 4, true));
        for (let c = 0; c < 4; c++) p.push(pv.getInt32(o + 8 + c * 4, true) / 1024);
      }
    }
    out.push({ c: channels, p });
  }
  return out;
}

export function parseScene(bytes: Uint8Array, name: string, cacheDir: string | null = null): ParsedScene {
  const steps = sceneSteps(bytes, name, cacheDir);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

export async function parseSceneAsync(bytes: Uint8Array, name: string, sliceMs = 4, cacheDir: string | null = null): Promise<ParsedScene> {
  const steps = sceneSteps(bytes, name, cacheDir);
  let t0 = performance.now();
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
    if (performance.now() - t0 >= sliceMs) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      t0 = performance.now();
    }
  }
}

function pngOf(b: Buffer, w: number, h: number): boolean {
  if (b.length < 57) return false;
  if (b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a) return false;
  if (b.toString("latin1", 12, 16) !== "IHDR" || b.readUInt32BE(16) !== w || b.readUInt32BE(20) !== h) return false;
  return b.toString("latin1", b.length - 8, b.length - 4) === "IEND";
}

export const SCENE_CACHE_DIR = join("runs", "scene-cache");
export const SCENE_CACHE_MAPS = 12;

async function keepPng(cacheDir: string, file: string, png: Buffer): Promise<void> {
  try {
    const dir = join(file, "..");
    const created = (await mkdir(dir, { recursive: true })) !== undefined;
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, png);
    await rename(tmp, file);
    const now = new Date();
    await utimes(dir, now, now);
    if (created) await trimSceneCache(cacheDir);
  } catch {

  }
}

export async function trimSceneCache(cacheDir: string, keep = SCENE_CACHE_MAPS): Promise<void> {
  try {
    const dirs: { path: string; at: number }[] = [];
    for (const e of await readdir(cacheDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const path = join(cacheDir, e.name);
      dirs.push({ path, at: (await stat(path)).mtimeMs });
    }
    dirs.sort((a, b) => b.at - a.at);
    for (const d of dirs.slice(keep)) await rm(d.path, { recursive: true, force: true });
  } catch {

  }
}
