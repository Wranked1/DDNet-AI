/* Portions derived from DDNet (https://github.com/ddnet/ddnet), zlib license:
   the sprite grid, weapon specs and animation keyframes of datasrc/content.py,
   CSkins::LoadSkin's recolouring, ColorHSLA, the camera and parallax math of
   engine/graphics.cpp, RenderEvalEnvelope, the scoreboard and HUD metrics and
   the freeze bar pieces, the entity overlays of render_map.cpp and
   render_layer.cpp (tele, speedup and switch tiles and their numbers).
   Copyright (C) 2007-2014 Magnus Auvinen (Teeworlds); Copyright (C) DDRace and
   DDNet contributors. This is an altered version, not the original software. */

export const SPRITES = {
  game: { gx: 32, gy: 16 },
  hookChain: [2, 0, 1, 1],
  hookHead: [3, 0, 2, 1],
  weapons: [

    { body: [2, 1, 4, 3], size: 96, ox: 4, oy: -20 },
    { body: [2, 4, 4, 2], size: 64, ox: 32, oy: 4 },
    { body: [2, 6, 8, 2], size: 96, ox: 24, oy: -2 },
    { body: [2, 8, 7, 2], size: 96, ox: 24, oy: -2 },
    { body: [2, 12, 7, 3], size: 92, ox: 24, oy: -2 },
    { body: [2, 10, 8, 2], size: 96, ox: 0, oy: 0 },
  ],

  cursors: [
    [0, 0, 2, 2],
    [0, 4, 2, 2],
    [0, 6, 2, 2],
    [0, 8, 2, 2],
    [0, 12, 2, 2],
    [0, 10, 2, 2],
  ],
  tee: { gx: 8, gy: 4 },
  body: [0, 0, 3, 3],
  bodyOutline: [3, 0, 3, 3],
  foot: [6, 1, 2, 1],
  footOutline: [6, 2, 2, 1],
  hand: [6, 0, 1, 1],
  handOutline: [7, 0, 1, 1],

  eyes: [
    [2, 3, 1, 1],
    [3, 3, 1, 1],
    [4, 3, 1, 1],
    [5, 3, 1, 1],
    [6, 3, 1, 1],
    [7, 3, 1, 1],
  ],
  emoticons: { gx: 4, gy: 4 },
  snowflake: [0, 0, 2, 2],
  hud: { gx: 16, gy: 16 },
  freezeBarFullLeft: [0, 2, 1, 1],
  freezeBarFull: [1, 2, 1, 1],
  freezeBarEmpty: [2, 2, 1, 1],
  freezeBarEmptyRight: [3, 2, 1, 1],
  airjump: [0, 0, 2, 2],
  airjumpEmpty: [2, 0, 2, 2],
  liveFrozen: [12, 4, 2, 2],
  deepFrozen: [10, 4, 2, 2],

  endlessJump: [8, 0, 2, 2],
  endlessHook: [10, 0, 2, 2],
  jetpack: [12, 0, 2, 2],
  teleGun: [6, 4, 2, 2],
  teleGrenade: [4, 4, 2, 2],
  teleLaser: [8, 4, 2, 2],
  solo: [4, 0, 2, 2],
  collisionOff: [6, 0, 2, 2],
  hookHitOff: [4, 2, 2, 2],
  hammerHitOff: [6, 2, 2, 2],
  shotgunHitOff: [8, 2, 2, 2],
  grenadeHitOff: [10, 2, 2, 2],
  laserHitOff: [12, 2, 2, 2],
  gunHitOff: [14, 2, 2, 2],
  practice: [4, 6, 2, 2],
  lockMode: [10, 6, 2, 2],
  team0Mode: [12, 6, 2, 2],
};

export const CHARFLAG = {
  solo: 1 << 0,
  jetpack: 1 << 1,
  collisionOff: 1 << 2,
  endlessHook: 1 << 3,
  endlessJump: 1 << 4,
  hammerHitOff: 1 << 6,
  shotgunHitOff: 1 << 7,
  grenadeHitOff: 1 << 8,
  laserHitOff: 1 << 9,
  hookHitOff: 1 << 10,
  teleGun: 1 << 11,
  teleGrenade: 1 << 12,
  teleLaser: 1 << 13,
  weaponHammer: 1 << 14,
  movementsOff: 1 << 20,
  inFreeze: 1 << 21,
  practice: 1 << 22,
  lockMode: 1 << 23,
  team0Mode: 1 << 24,
};

export const ANIMS = {
  base: { body: [[0, 0, -4, 0]], back: [[0, 0, 10, 0]], front: [[0, 0, 10, 0]], attach: [] as number[][] },
  idle: { body: [] as number[][], back: [[0, -7, 0, 0]], front: [[0, 7, 0, 0]], attach: [] as number[][] },
  inair: { body: [] as number[][], back: [[0, -3, 0, -0.1]], front: [[0, 3, 0, -0.1]], attach: [] as number[][] },
  walk: {
    body: [[0, 0, 0, 0], [0.2, 0, -1, 0], [0.4, 0, 0, 0], [0.6, 0, 0, 0], [0.8, 0, -1, 0], [1, 0, 0, 0]],
    back: [[0, 8, 0, 0], [0.2, -8, 0, 0], [0.4, -10, -4, 0.2], [0.6, -8, -8, 0.3], [0.8, 4, -4, -0.2], [1, 8, 0, 0]],
    front: [[0, -10, -4, 0.2], [0.2, -8, -8, 0.3], [0.4, 4, -4, -0.2], [0.6, 8, 0, 0], [0.8, 8, 0, 0], [1, -10, -4, 0.2]],
    attach: [] as number[][],
  },
  runLeft: {
    body: [[0, 0, -1, 0], [0.2, 0, 0, 0], [0.4, 0, -1, 0], [0.6, 0, 0, 0], [0.8, 0, 0, 0], [1, 0, -1, 0]],
    back: [[0, 18, -8, -0.27], [0.2, 6, 0, 0], [0.4, -7, 0, 0], [0.6, -13, -4.5, 0.05], [0.8, 0, -8, -0.2], [1, 18, -8, -0.27]],
    front: [[0, -11, -2.5, 0.05], [0.2, -14, -5, 0.1], [0.4, 11, -8, -0.3], [0.6, 18, -8, -0.27], [0.8, 3, 0, 0], [1, -11, -2.5, 0.05]],
    attach: [] as number[][],
  },
  runRight: {
    body: [[0, 0, -1, 0], [0.2, 0, 0, 0], [0.4, 0, 0, 0], [0.6, 0, -1, 0], [0.8, 0, 0, 0], [1, 0, -1, 0]],
    back: [[0, -18, -8, 0.27], [0.2, 0, -8, 0.2], [0.4, 13, -4.5, -0.05], [0.6, 7, 0, 0], [0.8, -6, 0, 0], [1, -18, -8, 0.27]],
    front: [[0, 11, -2.5, -0.05], [0.2, -3, 0, 0], [0.4, -18, -8, 0.27], [0.6, -11, -8, 0.3], [0.8, 14, -5, -0.1], [1, 11, -2.5, -0.05]],
    attach: [] as number[][],
  },
  hammer: {
    body: [] as number[][],
    back: [] as number[][],
    front: [] as number[][],
    attach: [[0, 0, 0, -0.1], [0.3, 0, 0, 0.25], [0.4, 0, 0, 0.3], [0.5, 0, 0, 0.25], [1, 0, 0, -0.1]],
  },
  ninja: {
    body: [] as number[][],
    back: [] as number[][],
    front: [] as number[][],
    attach: [[0, 0, 0, -0.25], [0.1, 0, 0, -0.05], [0.15, 0, 0, 0.35], [0.42, 0, 0, 0.4], [0.5, 0, 0, 0.35], [1, 0, 0, -0.25]],
  },
};

export function animSeq(frames: number[][], t: number): number[] {
  if (frames.length === 0) return [0, 0, 0];
  if (frames.length === 1) return [frames[0][1], frames[0][2], frames[0][3]];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (a[0] <= t && b[0] >= t) {
      const k = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
    }
  }
  return [0, 0, 0];
}

export function animState(parts: { anim: { body: number[][]; back: number[][]; front: number[][]; attach: number[][] }; t: number; amount: number }[]): {
  body: number[];
  back: number[];
  front: number[];
  attach: number[];
} {
  const out = { body: [0, 0, 0], back: [0, 0, 0], front: [0, 0, 0], attach: [0, 0, 0] };
  for (const p of parts) {
    for (const key of ["body", "back", "front", "attach"] as const) {
      const v = animSeq(p.anim[key], p.t);
      out[key][0] += v[0] * p.amount;
      out[key][1] += v[1] * p.amount;
      out[key][2] += v[2] * p.amount;
    }
  }
  return out;
}

export function teeAnimFor(vx: number, inAir: boolean, dir: number, x: number, attackSec: number, weapon: number): {
  body: number[];
  back: number[];
  front: number[];
  attach: number[];
} {
  const parts = [{ anim: ANIMS.base, t: 0, amount: 1 }];

  const stationary = Math.abs(vx) <= 1 / 256;
  const running = Math.abs(vx) >= 5000 / 256;
  const wantOther = (dir === -1 && vx > 0) || (dir === 1 && vx < 0);
  let walk = (x % 100) / 100;
  if (walk < 0) walk += 1;
  let run = (x % 200) / 200;
  if (run < 0) run += 1;
  if (inAir) parts.push({ anim: ANIMS.inair, t: 0, amount: 1 });
  else if (stationary) parts.push({ anim: ANIMS.idle, t: 0, amount: 1 });
  else if (!wantOther) {
    if (running) parts.push({ anim: vx < 0 ? ANIMS.runLeft : ANIMS.runRight, t: run, amount: 1 });
    else parts.push({ anim: ANIMS.walk, t: walk, amount: 1 });
  }
  if (weapon === 0) parts.push({ anim: ANIMS.hammer, t: Math.min(1, Math.max(0, attackSec * 5)), amount: 1 });
  if (weapon === 5) parts.push({ anim: ANIMS.ninja, t: Math.min(1, Math.max(0, attackSec * 2)), amount: 1 });
  return animState(parts);
}

export function ddnetColor(packed: number, darkest: number = 0.5): number[] {
  const h = ((packed >>> 16) & 0xff) / 255;
  const s = ((packed >>> 8) & 0xff) / 255;
  let l = (packed & 0xff) / 255;
  l = darkest + l * (1 - darkest);
  const h1 = h * 6;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h1 % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  switch (Math.trunc(h1)) {
    case 0:
      r = c;
      g = x;
      break;
    case 1:
      r = x;
      g = c;
      break;
    case 2:
      g = c;
      b = x;
      break;
    case 3:
      g = x;
      b = c;
      break;
    case 4:
      r = x;
      b = c;
      break;
    default:
      r = c;
      b = x;
      break;
  }
  const m = l - c / 2;
  return [r + m, g + m, b + m];
}

export function skinColorable(px: Uint8ClampedArray | Uint8Array, w: number, h: number): void {
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const luma = Math.trunc(0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]);
    px[o] = luma;
    px[o + 1] = luma;
    px[o + 2] = luma;
  }
  const bw = Math.trunc((w * 3) / 8);
  const bh = Math.trunc((h * 3) / 4);
  const freq = new Array(256).fill(0);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const o = (y * w + x) * 4;
      if (px[o + 3] > 128) freq[px[o]]++;
    }
  }
  let org = 1;
  for (let i = 1; i < 256; i++) if (freq[org] < freq[i]) org = i;
  const neu = 192;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const o = (y * w + x) * 4;
      let v = px[o];
      if (v <= org) v = Math.trunc((v / org) * neu);
      else v = Math.trunc(((v - org) / (255 - org)) * (255 - neu) + neu);
      px[o] = v;
      px[o + 1] = v;
      px[o + 2] = v;
    }
  }
}

export function skinTint(src: Uint8ClampedArray | Uint8Array, w: number, h: number, body: number[], feet: number[], feetDim: number = 1): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  const fx0 = Math.trunc((w * 6) / 8);
  const fy0 = Math.trunc(h / 4);
  const fy1 = Math.trunc((h * 3) / 4);
  const fyFill = Math.trunc(h / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const isFeet = x >= fx0 && y >= fy0 && y < fy1;
      const c = isFeet ? feet : body;
      const dim = isFeet && y < fyFill ? feetDim : 1;
      out[o] = src[o] * c[0] * dim;
      out[o + 1] = src[o + 1] * c[1] * dim;
      out[o + 2] = src[o + 2] * c[2] * dim;
      out[o + 3] = src[o + 3];
    }
  }
  return out;
}

export function spriteRect(cell: number[], grid: { gx: number; gy: number }, imgW: number, imgH: number): number[] {
  const cw = imgW / grid.gx;
  const ch = imgH / grid.gy;
  return [cell[0] * cw, cell[1] * ch, cell[2] * cw, cell[3] * ch];
}

export function spriteScale(cell: number[]): number[] {
  const f = Math.hypot(cell[2], cell[3]);
  return [cell[2] / f, cell[3] / f];
}

export function tileMatrix(flags: number): number[] {

  let u = [0, 1, 1, 0];
  let v = [0, 0, 1, 1];
  if (flags & 1) u = [u[1], u[0], u[3], u[2]];
  if (flags & 2) v = [v[3], v[2], v[1], v[0]];
  if (flags & 8) {
    u = [u[3], u[0], u[1], u[2]];
    v = [v[3], v[0], v[1], v[2]];
  }

  return affine3([u[0], v[0], u[1], v[1], u[3], v[3]], [0, 0, 1, 0, 0, 1]);
}

export function affine3(s: number[], d: number[]): number[] {
  const sx1 = s[2] - s[0];
  const sy1 = s[3] - s[1];
  const sx2 = s[4] - s[0];
  const sy2 = s[5] - s[1];
  const det = sx1 * sy2 - sx2 * sy1;
  if (Math.abs(det) < 1e-12) return [1, 0, 0, 1, 0, 0];
  const dx1 = d[2] - d[0];
  const dy1 = d[3] - d[1];
  const dx2 = d[4] - d[0];
  const dy2 = d[5] - d[1];
  const a = (dx1 * sy2 - dx2 * sy1) / det;
  const c = (dx2 * sx1 - dx1 * sx2) / det;
  const b = (dy1 * sy2 - dy2 * sy1) / det;
  const dd = (dy2 * sx1 - dy1 * sx2) / det;
  return [a, b, c, dd, d[0] - a * s[0] - c * s[1], d[1] - b * s[0] - dd * s[1]];
}

export function groupView(cx: number, cy: number, zoom: number, aspect: number, px: number, py: number, ox: number, oy: number): number[] {
  const amount = 1150 * 1000;
  const f = Math.sqrt(amount) / Math.sqrt(aspect);
  let w = f * aspect;
  let h = f;
  if (w > 1500) {
    w = 1500;
    h = w / aspect;
  }
  if (h > 1050) {
    h = 1050;
    w = h * aspect;
  }
  w *= zoom;
  h *= zoom;
  const pz = Math.min(100, Math.max(0, Math.max(px, py)));
  const scale = (pz * (zoom - 1) + 100) / 100 / zoom;
  w *= scale;
  h *= scale;
  const x = cx * (px / 100);
  const y = cy * (py / 100);
  return [ox + x - w / 2, oy + y - h / 2, w, h];
}

export function chunkLod(pxPerTile: number): { lod: number; tiles: number } {
  let lod = 2;
  while (lod < 64 && lod < pxPerTile) lod *= 2;
  return { lod, tiles: Math.min(64, Math.max(8, 512 / lod)) };
}

export function specialTiles(buf: Uint8Array, role: string, count: number): { pos: Int32Array; f: Uint8Array; n: number } {
  const nf = role === "tele" ? 2 : role === "switch" ? 4 : 5;
  const most = Math.floor(buf.length / (1 + nf));
  const pos = new Int32Array(most);
  const f = new Uint8Array(most * 5);
  let n = 0;
  let at = -1;
  let r = 0;
  while (r < buf.length && n < most) {
    let gap = 0;
    let shift = 0;
    let b = 0x80;
    while (r < buf.length && b & 0x80 && shift < 35) {
      b = buf[r++];
      gap += (b & 0x7f) * 2 ** shift;
      shift += 7;
    }
    if (b & 0x80 || r + nf > buf.length) break;
    at += gap + 1;
    if (at >= count) break;
    pos[n] = at;
    for (let k = 0; k < nf; k++) f[n * 5 + k] = buf[r + k];
    r += nf;
    n++;
  }
  return { pos, f, n };
}

export function specialLook(role: string, f: Uint8Array, o: number): { tile: number; flags: number; arrow: number | null; center: number; top: number; bottom: number } {
  const type = f[o];
  if (role === "tele") {

    return { tile: type, flags: 0, arrow: null, center: type !== 31 && type !== 63 ? f[o + 1] : 0, top: 0, bottom: 0 };
  }
  if (role === "switch") {

    const number = type !== 7 && type !== 19 && type !== 20 && type !== 98 && type !== 99 ? f[o + 2] : 0;
    const delay = type !== 12 && type !== 13 ? f[o + 3] : 0;
    return { tile: type === 22 ? 8 : type, flags: f[o + 1], arrow: null, center: 0, top: number, bottom: delay };
  }

  const force = f[o + 1];
  const max = f[o + 2];
  if (!((type === 28 && force !== 0) || (type === 29 && (force !== 0 || max !== 0)))) return { tile: 0, flags: 0, arrow: null, center: 0, top: 0, bottom: 0 };
  const angle = f[o + 3] | (f[o + 4] << 8);
  return { tile: 0, flags: 0, arrow: angle >= 0x8000 ? angle - 0x10000 : angle, center: 0, top: max, bottom: force };
}

export function overlayNumber(n: number, where: string): { size: number; top: number } {
  const digits = String(n).length;
  const high = where === "center" ? 64 : 32;
  const fit = Math.min(high, Math.trunc(64 / (digits * 0.636)));
  const size = Math.trunc(fit * 0.92);

  const top = (where === "center" ? 6 : where === "top" ? 3 : 35) + Math.trunc((high - size) / 2);
  return { size: size / 64, top: top / 64 };
}

export function tickClock(prevOffset: number | null, tick: number, nowMs: number): number {
  const o = tick * 20 - nowMs;
  if (prevOffset === null || Math.abs(o - prevOffset) > 400) return o;

  return o > prevOffset ? o : prevOffset + (o - prevOffset) * 0.05;
}

export function envEval(points: number[], channels: number, timeMs: number): number[] {
  const n = Math.floor(points.length / 6);
  const out: number[] = [];
  if (n === 0 || channels <= 0) return out;
  if (n === 1) {
    for (let c = 0; c < channels; c++) out.push(points[2 + c]);
    return out;
  }
  const maxT = points[(n - 1) * 6];
  let t = maxT > 0 ? timeMs % maxT : 0;
  if (t < 0) t += maxT;

  const ti = Math.trunc(t);
  let found = -1;
  let lo = 0;
  let hi = n - 2;
  while (lo <= hi) {
    const mid = lo + ((hi - lo) >> 1);
    const a = points[mid * 6];
    const b = points[(mid + 1) * 6];
    if (ti >= a && ti < b) {
      found = mid;
      break;
    }
    if (ti < a) hi = mid - 1;
    else lo = mid + 1;
  }
  const at = found < 0 ? n - 1 : found;
  if (found < 0 || points[(found + 1) * 6] - points[found * 6] <= 0) {
    for (let c = 0; c < channels; c++) out.push(points[at * 6 + 2 + c]);
    return out;
  }
  const t0 = points[found * 6];
  let a = (t - t0) / (points[(found + 1) * 6] - t0);
  switch (points[found * 6 + 1]) {
    case 0:
      a = 0;
      break;
    case 2:
      a = a * a * a;
      break;
    case 3:
      a = 1 - a;
      a = 1 - a * a * a;
      break;
    case 4:
      a = -2 * a * a * a + 3 * a * a;
      break;
    default:
      break;
  }
  for (let c = 0; c < channels; c++) {
    const v0 = points[found * 6 + 2 + c];
    const v1 = points[(found + 1) * 6 + 2 + c];
    out.push(v0 + (v1 - v0) * a);
  }
  return out;
}

export function envRgbConst(points: number[], channels: number): number[] | null {
  const n = Math.floor(points.length / 6);
  const rgb = [1, 1, 1];
  for (let c = 0; c < Math.min(3, channels); c++) {
    if (n > 0) rgb[c] = points[2 + c];
    for (let i = 1; i < n; i++) if (Math.abs(points[i * 6 + 2 + c] - rgb[c]) > 1e-6) return null;
  }
  return rgb;
}

export function buildPasses<L extends { kind: string; role?: string; env?: number; envOff?: number }>(
  groups: { ox: number; oy: number; px: number; py: number; clip: number[] | null; layers: L[] }[],
): {
  passes: { kind: string; g: number; side: string; layers: L[]; key: string; env: number; envOff: number }[];
  ent: { g: number; layer: L }[];
} {
  const passes: { kind: string; g: number; side: string; layers: L[]; key: string; env: number; envOff: number }[] = [];
  const ent: { g: number; layer: L }[] = [];
  let side = "bg";
  const same = (a: number, b: number): boolean => {
    const x = groups[a];
    const y = groups[b];
    if (x.px !== y.px || x.py !== y.py) return false;
    if (x.clip === null || y.clip === null) return x.clip === y.clip;
    for (let i = 0; i < 4; i++) if (x.clip[i] !== y.clip[i]) return false;
    return true;
  };
  groups.forEach((g, gi) => {
    for (const l of g.layers) {
      if (l.role === "game" || l.role === "front" || l.role === "tele" || l.role === "speedup" || l.role === "switch") {
        ent.push({ g: gi, layer: l });
        if (l.role === "game") side = "fg";
        continue;
      }
      const env = l.kind === "tiles" ? (l.env ?? -1) : -1;
      const last = passes[passes.length - 1];
      if (l.kind === "tiles" && env < 0 && last && last.kind === "tiles" && last.env < 0 && last.side === side && (last.g === gi || same(last.g, gi))) {
        last.layers.push(l);
      } else {
        passes.push({ kind: l.kind, g: gi, side, layers: [l], key: "p" + passes.length, env, envOff: l.kind === "tiles" ? (l.envOff ?? 0) : 0 });
      }
    }
  });
  return { passes, ent };
}

export function gradientPixels(col: number[], n: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) {
    const v = n > 1 ? y / (n - 1) : 0;
    for (let x = 0; x < n; x++) {
      const u = n > 1 ? x / (n - 1) : 0;
      const o = (y * n + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = col[c] + (col[4 + c] - col[c]) * u;
        const bottom = col[8 + c] + (col[12 + c] - col[8 + c]) * u;
        out[o + c] = Math.round(top + (bottom - top) * v);
      }
    }
  }
  return out;
}

export function hslRgb(h: number, s: number, l: number): number[] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const h6 = (((h % 1) + 1) % 1) * 6;
  const x = c * (1 - Math.abs((h6 % 2) - 1));
  const m = l - c / 2;
  const i = Math.floor(h6);
  const rgb = i === 0 ? [c, x, 0] : i === 1 ? [x, c, 0] : i === 2 ? [0, c, x] : i === 3 ? [0, x, c] : i === 4 ? [x, 0, c] : [c, 0, x];
  return [rgb[0] + m, rgb[1] + m, rgb[2] + m];
}

export function boardMetrics(n: number, narrow: boolean): { line: number; tee: number; spacing: number; round: number; font: number } {
  if (n <= 8) return { line: 30, tee: 0.5, spacing: 8, round: 5, font: 12 };
  if (n <= 12) return { line: 25, tee: 0.45, spacing: 2.5, round: 5, font: 12 };
  if (n <= 16) return { line: 20, tee: 0.4, spacing: 0, round: 2.5, font: 12 };
  if (n <= 24) return { line: 13.5, tee: 0.3, spacing: 0, round: 2.5, font: 10 };
  if (n <= 32) return { line: 10, tee: 0.2, spacing: 0, round: 2.5, font: 8 };
  if (narrow && n <= 48) return { line: 7.5, tee: 0.125, spacing: 0, round: 1, font: 7 };
  return { line: 5, tee: 0.1, spacing: 0, round: 1, font: 5 };
}

export function boardColumns(n: number): { cols: number; per: number; width: number } {
  if (n <= 16) return { cols: 1, per: Math.max(1, n), width: 385 };
  if (n <= 24) return { cols: 2, per: 12, width: 750 };
  if (n <= 32) return { cols: 2, per: 16, width: 750 };
  if (n <= 48) return { cols: 2, per: 24, width: 750 };
  if (n <= 64) return { cols: 2, per: 32, width: 750 };
  return { cols: 3, per: Math.ceil(128 / 3), width: 750 };
}

export function boardScore(score: number, timeScore: boolean): string {
  if (!timeScore) return score <= -9999 ? "" : String(Math.max(-999, Math.min(99999, score)));
  if (score === -9999) return "";
  const s = Math.abs(Math.trunc(score));
  const two = (n: number): string => String(n).padStart(2, "0");
  return (s >= 3600 ? two(Math.floor(s / 3600)) + ":" : "") + two(Math.floor((s % 3600) / 60)) + ":" + two(s % 60);
}

export function hudWeapons(flags: number | undefined, held: number): number[] {
  const out: number[] = [];
  if (flags !== undefined) {
    for (let w = 0; w < 6; w++) if ((flags & ((1 << 14) << w)) !== 0) out.push(w);
    if (out.length > 0) return out;
  }
  out.push(0, 1);
  if (held >= 2 && held <= 5) out.push(held);
  return out;
}

export function jumpIcons(total: number | undefined, left: number | undefined, jumped: number): { total: number; avail: number } {
  const all = Math.max(0, Math.min(10, Math.abs(total ?? 2)));
  const avail = left ?? ((jumped & 2) !== 0 ? 0 : 1);
  return { total: all, avail: Math.max(0, Math.min(all, avail)) };
}

export function freezeBarPieces(progress: number): { s: string; u0: number; u1: number; x: number; w: number }[] {
  const p = Math.max(0, Math.min(1, progress));
  const end = 16;
  const mid = 64 - 2 * end;
  const endProg = end * 0.5;
  const endRest = end * 0.5;
  const progW = 64 - 2 * endProg;
  const endProp = endProg / progW;
  const midProp = mid / progW;
  const out: { s: string; u0: number; u1: number; x: number; w: number }[] = [];
  const begin = p <= endProp ? p / endProp : 1;
  out.push({ s: "fullLeft", u0: 0, u1: 0.5 + 0.5 * begin, x: 0, w: endRest + endProg * begin });
  if (begin < 1) out.push({ s: "emptyRight", u0: 0.5 - 0.5 * begin, u1: 0, x: endRest + endProg * begin, w: endProg * (1 - begin) });
  const midP = p <= endProp + midProp ? (p <= endProp ? 0 : (p - endProp) / midProp) : 1;
  const fullW = mid * midP;
  const emptyW = mid - fullW;
  if (fullW > 0) out.push({ s: "full", u0: 0, u1: fullW <= end ? fullW / end : 1, x: end, w: fullW });
  if (emptyW > 0) out.push({ s: "empty", u0: emptyW <= end ? emptyW / end : 1, u1: 0, x: end + fullW, w: emptyW });
  const endP = p <= endProp + midProp ? 0 : (p - endProp - midProp) / endProp;
  if (endP > 0) out.push({ s: "fullLeft", u0: 1, u1: 1 - 0.5 * endP, x: end + mid, w: endProg * endP });
  out.push({ s: "emptyRight", u0: 0.5 - 0.5 * (1 - endP), u1: 1, x: end + mid + endProg * endP, w: endProg * (1 - endP) + endRest });
  return out;
}

export function flakeStep(p: { x: number; y: number; vx: number; vy: number; g: number; rot: number; life: number }, dt: number, frictionSteps: number): void {
  p.vy += p.g * dt;
  for (let i = 0; i < frictionSteps; i++) {
    p.vx *= 0.9;
    p.vy *= 0.9;
  }
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.rot += Math.PI * dt;
  p.life += dt;
}
