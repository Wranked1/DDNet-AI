import type { Collision } from "../core/collision.ts";
import { TILE_DEATH, TILE_FREEZE, TILE_NOHOOK, TILE_SOLID } from "../core/tuning.ts";
import type { Crossing, TileBox, WallRoute } from "./crossing.ts";
import { hookableAnchor, inAnyBox, shiftBox, shiftCrossing, wallRouteOk } from "./crossing.ts";

export type WbSide = "left" | "right";

export type WbSideDef = {

  zone: readonly TileBox[];

  approach: readonly TileBox[];

  leash: readonly TileBox[];

  spots: readonly { tx: number; ty: number }[];

  watch: { tx: number; ty: number };

  crossing: Crossing;
};

export type WbDef = {
  name: string;
  left: WbSideDef;
  right: WbSideDef;

  avoid: readonly TileBox[];

  crossings: readonly Crossing[];

  size: { w: number; h: number };

  oneSided?: WbSide;
};

export const WB_LEASH_TILES = 3;

function grow(b: TileBox, n: number): TileBox {
  return { x0: b.x0 - n, y0: b.y0 - n, x1: b.x1 + n, y1: b.y1 + n };
}

function side(zone: TileBox[], approach: TileBox[], spots: { tx: number; ty: number }[], watch: { tx: number; ty: number }, crossing: Crossing): WbSideDef {
  return { zone, approach, leash: [...zone.map((b) => grow(b, WB_LEASH_TILES)), ...approach], spots, watch, crossing };
}

const MIRROR = 234;
const mirrorBox = (b: TileBox): TileBox => ({ x0: MIRROR - b.x1, y0: b.y0, x1: MIRROR - b.x0, y1: b.y1 });

const FROM: TileBox[] = [
  { x0: 103, y0: 29, x1: 131, y1: 35 },
  { x0: 107, y0: 36, x1: 127, y1: 50 },
];
const CHAMBER: TileBox = { x0: 108, y0: 36, x1: 126, y1: 50 };

const LEFT_WALL: WallRoute = {
  anchors: [
    { tx: 95, ty: 56 },
    { tx: 95, ty: 55 },
    { tx: 95, ty: 54 },
    { tx: 95, ty: 57 },
    { tx: 95, ty: 53 },
  ],
  shelf: [{ x0: 93, y0: 80, x1: 104, y1: 84 }],
  room: [{ x0: 99, y0: 59, x1: 107, y1: 63 }],
  lastRow: 58,
  missRow: 64,
};
const LEFT_TUBE: Crossing = {
  label: "the left freeze tube",
  from: FROM,
  chamber: CHAMBER,
  start: { tx: 104, ty: 35 },
  anchors: [
    { tx: 107, ty: 37 },
    { tx: 107, ty: 38 },
    { tx: 107, ty: 39 },
    { tx: 105, ty: 40 },
    { tx: 106, ty: 40 },
    { tx: 107, ty: 40 },
    { tx: 103, ty: 39 },
    { tx: 102, ty: 38 },
  ],

  directAnchors: [7, 0, 6],

  landing: [{ x0: 95, y0: 41, x1: 103, y1: 50 }],

  exit: [
    { x0: 87, y0: 51, x1: 92, y1: 63 },
    { x0: 87, y0: 64, x1: 91, y1: 65 },
  ],
  exitTile: { tx: 89, ty: 60 },

  hall: [
    { x0: 79, y0: 67, x1: 104, y1: 79 },
    { x0: 78, y0: 79, x1: 104, y1: 87 },
  ],
  hallTile: { tx: 90, ty: 79 },
  toward: -1,
  wall: LEFT_WALL,
};
const RIGHT_TUBE: Crossing = {
  label: "the right freeze tube",
  from: FROM,
  chamber: CHAMBER,
  start: { tx: 130, ty: 35 },
  anchors: LEFT_TUBE.anchors.map((a) => ({ tx: MIRROR - a.tx, ty: a.ty })),
  directAnchors: LEFT_TUBE.directAnchors,
  landing: LEFT_TUBE.landing.map(mirrorBox),
  exit: LEFT_TUBE.exit.map(mirrorBox),
  exitTile: { tx: MIRROR - LEFT_TUBE.exitTile.tx, ty: LEFT_TUBE.exitTile.ty },
  hall: (LEFT_TUBE.hall ?? []).map(mirrorBox),
  hallTile: { tx: MIRROR - 90, ty: 79 },
  toward: 1,
  wall: {
    ...LEFT_WALL,
    anchors: LEFT_WALL.anchors.map((a) => ({ tx: MIRROR - a.tx, ty: a.ty })),
    shelf: LEFT_WALL.shelf.map(mirrorBox),
    room: LEFT_WALL.room.map(mirrorBox),
  },
};

const L1: TileBox = { x0: 79, y0: 67, x1: 104, y1: 79 };
const L2: TileBox = { x0: 78, y0: 79, x1: 104, y1: 87 };
const LEFT_APPROACH: TileBox = { x0: 84, y0: 41, x1: 103, y1: 66 };

export const WB_GUARD = process.env.WB_GUARD !== "0";

export const WB_CHAIN = WB_GUARD && process.env.WB_CHAIN === "1";
const LEFT_SPOTS = WB_GUARD ? [{ tx: 83, ty: 79 }, { tx: 94, ty: 84 }, { tx: 101, ty: 84 }] : [{ tx: 94, ty: 84 }, { tx: 82, ty: 79 }, { tx: 101, ty: 84 }];

const RIGHT_SPOTS = WB_GUARD
  ? [{ tx: MIRROR - 83, ty: 79 }, { tx: MIRROR - 94, ty: 84 }, { tx: MIRROR - 101, ty: 84 }]
  : [{ tx: 152, ty: 79 }, { tx: MIRROR - 94, ty: 84 }, { tx: MIRROR - 101, ty: 84 }];

const LEFT_WATCH = { tx: 89, ty: 79 };

const COPY_LOVE_BOX: WbDef = {
  name: "Copy Love Box",
  left: side([L1, L2], [LEFT_APPROACH], LEFT_SPOTS, LEFT_WATCH, LEFT_TUBE),
  right: side(
    [mirrorBox(L1), mirrorBox(L2)],
    [mirrorBox(LEFT_APPROACH)],
    RIGHT_SPOTS,
    { tx: MIRROR - LEFT_WATCH.tx, ty: LEFT_WATCH.ty },
    RIGHT_TUBE,
  ),
  avoid: [{ x0: 96, y0: 12, x1: 140, y1: 24 }],
  crossings: [LEFT_TUBE, RIGHT_TUBE],
  size: { w: 387, h: 250 },
};

function shiftSide(s: WbSideDef, dx: number, dy: number): WbSideDef {
  return {
    zone: s.zone.map((b) => shiftBox(b, dx, dy)),
    approach: s.approach.map((b) => shiftBox(b, dx, dy)),
    leash: s.leash.map((b) => shiftBox(b, dx, dy)),
    spots: s.spots.map((p) => ({ tx: p.tx + dx, ty: p.ty + dy })),
    watch: { tx: s.watch.tx + dx, ty: s.watch.ty + dy },
    crossing: shiftCrossing(s.crossing, dx, dy),
  };
}

function shiftDef(d: WbDef, name: string, dx: number, dy: number, size: { w: number; h: number }): WbDef {
  const left = shiftSide(d.left, dx, dy);
  const right = shiftSide(d.right, dx, dy);
  return { name, left, right, avoid: d.avoid.map((b) => shiftBox(b, dx, dy)), crossings: [left.crossing, right.crossing], size };
}

function shiftSplitDef(d: WbDef, name: string, dxL: number, dxR: number, dy: number, size: { w: number; h: number }): WbDef {
  const l = shiftSide(d.left, dxL, dy);
  const r = shiftSide(d.right, dxR, dy);
  const across = (a: TileBox, b: TileBox): TileBox => ({ x0: a.x0, y0: Math.min(a.y0, b.y0), x1: b.x1, y1: Math.max(a.y1, b.y1) });
  const from = l.crossing.from.map((b, i) => across(b, r.crossing.from[i]));
  const chamber = across(l.crossing.chamber, r.crossing.chamber);
  const left = { ...l, crossing: { ...l.crossing, from, chamber } };
  const right = { ...r, crossing: { ...r.crossing, from, chamber } };
  const avoid = [dxL, dxR].flatMap((dx) => d.avoid.map((b) => shiftBox(b, dx, dy)));
  return { name, left, right, avoid, crossings: [left.crossing, right.crossing], size };
}

const COPY_THE_BOX_TF: WbDef = {
  ...shiftSplitDef(COPY_LOVE_BOX, "Copy The Box TF", 175, 177, 28, { w: 650, h: 400 }),
  avoid: [{ x0: 271, y0: 40, x1: 317, y1: 52 }],
};

const CLB2S_DY = 10;
const CLB2S_RIGHT_TUBE: Crossing = {
  ...shiftCrossing(RIGHT_TUBE, 0, CLB2S_DY),

  from: [
    { x0: 79, y0: 37, x1: 119, y1: 45 },
    { x0: 88, y0: 46, x1: 127, y1: 60 },
  ],

  chamber: { x0: 88, y0: 46, x1: 115, y1: 60 },

  approachDepth: 5,
  start: { tx: 117, ty: 45 },

  anchors: [
    { tx: 119, ty: 49 },
    { tx: 118, ty: 50 },
    { tx: 116, ty: 50 },
    { tx: 114, ty: 50 },
    { tx: 112, ty: 50 },
    { tx: 111, ty: 50 },
    { tx: 111, ty: 49 },
    { tx: 111, ty: 48 },
    { tx: 111, ty: 47 },
    { tx: 111, ty: 46 },
  ],

  directAnchors: [0, 1, 7],

  leadAim: true,

  landing: [{ x0: 132, y0: 51, x1: 139, y1: 60 }],

  jumpOff: [{ x0: 84, y0: 45, x1: 87, y1: 45 }],
};

const CLB2S_TUBE: TileBox = { x0: 129, y0: 51, x1: 131, y1: 60 };
const CLB2S_RIGHT: WbSideDef = { ...shiftSide(COPY_LOVE_BOX.right, 0, CLB2S_DY), crossing: CLB2S_RIGHT_TUBE };

const COPY_LOVE_BOX_2S: WbDef = {
  name: "Copy Love Box 2s",
  left: CLB2S_RIGHT,
  right: CLB2S_RIGHT,
  avoid: [{ x0: 81, y0: 6, x1: 113, y1: 19 }],
  crossings: [CLB2S_RIGHT_TUBE],
  size: { w: 425, h: 400 },
  oneSided: "right",
};

function shift2s(name: string, dx: number, dy: number, size: { w: number; h: number }): WbDef {
  const right = shiftSide(COPY_LOVE_BOX_2S.right, dx, dy);
  return { ...COPY_LOVE_BOX_2S, name, left: right, right, avoid: COPY_LOVE_BOX_2S.avoid.map((b) => shiftBox(b, dx, dy)), crossings: [right.crossing], size };
}

export const WAYBLOCKS: readonly WbDef[] = [COPY_LOVE_BOX, shiftDef(COPY_LOVE_BOX, "Copy Love Box JoniTee", 182, 212, { w: 600, h: 600 }), COPY_THE_BOX_TF];

export const HALL_X0 = 76;
export const HALL_Y0 = 64;
export const HALL_CORE: readonly string[] = [
  ".......#~~~.....~~~~....###############~~~~~###############....~~~~.....~~~#.......",
  ".......#~~~.....~~~#....#~~~~~~~~~~~...........~~~~~~~~~~~#....#~~~.....~~~#.......",
  "...########~~~~~####....#~...~~.....................~~...~#....####~~~~~########...",
  "...#~~~~~~~~~~~~~~~#~~~~##...~~.....................~~...##~~~~#~~~~~~~~~~~~~~~#...",
  "...#.........................~~.....................~~.........................#...",
  "...#.........................~~.....................~~.........................#...",
  "...#.........................~~.....................~~.........................#...",
  "####.........................~~.....................~~.........................####",
  "~~~~.........................~~.....................~~.........................~~~~",
  "~~~~.........................~~.....................~~.........................~~~~",
  "~~~~.........................~~.....................~~.........................~~~~",
  ".~~~.........................##.....................##.........................~~~.",
  ".~~~.........................#########################.........................~~~.",
  ".~~~.........................~~~~~~~~.........~~~~~~~~.........................~~~.",
  ".~~~.........................~~~~~~~...~~~~~...~~~~~~~.........................~~~.",
  ".~~~.........................~~~#~...~~~~~~~~~...~#~~~.........................~~~.",
  ".################............~~~#...~~~~~~~~~~~...#~~~............################.",
  "..~#~~~~~~~~~~~~~............~~~~###~~~~~~~~~~~###~~~~............~~~~~~~~~~~~~#~..",
  "..~#~~~~~~~~~~~~~............~~~~~~~~~~~~~~~~~~~~~~~~~............~~~~~~~~~~~~~#~..",
  "..~#~~~~~~~~~~~~~............~~.....................~~............~~~~~~~~~~~~~#~..",
  "..~#~~~~~~~~~~~~~............~~.....................~~............~~~~~~~~~~~~~#~..",
  "..~#########~~~##############~~.....................~~##############~~~#########~..",
  "..~~~~~~~~~#~~~#~~~~~~~~~~~~~~~.....................~~~~~~~~~~~~~~~#~~~#~~~~~~~~~..",
  "..~~~~~~~~##~~~##~~~~~~~~~~~~~~.....................~~~~~~~~~~~~~~##~~~##~~~~~~~~..",
  ".............................~~.....................~~.............................",
  ".............................~~.....................~~.............................",
  ".............................~~.....................~~.............................",
  ".............................~~.....................~~.............................",
  ".............................~~.....................~~.............................",
];

export function standable(col: Collision, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= col.width || ty + 1 >= col.height) return false;
  const px = tx * 32 + 16;
  const py = ty * 32 + 16;
  if (col.isSolid(px, py) || col.isFreeze(px, py) || col.isDeath(px, py)) return false;
  return col.isSolid(px, py + 32);
}

const HALL_W = HALL_CORE[0].length;
const HALL_H = HALL_CORE.length;

const hallClasses = Uint8Array.from(HALL_CORE.join(""), (c) => (c === "#" ? 1 : c === "~" ? 2 : c === "X" ? 3 : 0));

const HALL_MATCH = 0.95;

const SAMPLE_MIN = 0.8;
const sampleAt: number[] = [];
{
  let nonAir = 0;
  let air = 0;
  for (let i = 0; i < hallClasses.length; i++) {
    if (hallClasses[i] !== 0) {
      if (nonAir++ % 25 === 0) sampleAt.push(i);
    } else if (air++ % 150 === 0) sampleAt.push(i);
  }
}
const SAMPLE_X = Int32Array.from(sampleAt, (i) => i % HALL_W);
const SAMPLE_Y = Int32Array.from(sampleAt, (i) => Math.trunc(i / HALL_W));
const SAMPLE_C = Uint8Array.from(sampleAt, (i) => hallClasses[i]);

function hallGrid(col: Collision): Uint8Array {
  const tiles = col.tiles;
  const grid = new Uint8Array(col.width * col.height);
  for (let i = 0; i < grid.length; i++) {
    const t = tiles[i];
    grid[i] = t === TILE_SOLID || t === TILE_NOHOOK ? 1 : t === TILE_FREEZE ? 2 : t === TILE_DEATH ? 3 : 0;
  }
  return grid;
}

export function findHallOffset(col: Collision): { dx: number; dy: number; match: number } | null {
  const w = col.width;
  const h = col.height;
  if (w < HALL_W || h < HALL_H) return null;
  const grid = hallGrid(col);
  const n = SAMPLE_C.length;
  const sampleOff = new Int32Array(n);
  for (let k = 0; k < n; k++) sampleOff[k] = SAMPLE_Y[k] * w + SAMPLE_X[k];

  const sampleLimit = Math.floor(n * (1 - SAMPLE_MIN) + 1e-9);
  const total = HALL_W * HALL_H;
  const limit = Math.floor(total * (1 - HALL_MATCH) + 1e-9);
  let bestMis = limit + 1;
  let best: { dx: number; dy: number } | null = null;
  for (let oy = 0; oy + HALL_H <= h; oy++) {
    for (let ox = 0; ox + HALL_W <= w; ox++) {
      const base = oy * w + ox;
      let mis = 0;
      for (let k = 0; k < n && mis <= sampleLimit; k++) if (grid[base + sampleOff[k]] !== SAMPLE_C[k]) mis++;
      if (mis > sampleLimit) continue;

      mis = 0;
      const max = bestMis - 1;
      for (let y = 0; y < HALL_H && mis <= max; y++) {
        const g = base + y * w;
        const s = y * HALL_W;
        for (let x = 0; x < HALL_W; x++) if (grid[g + x] !== hallClasses[s + x]) mis++;
      }
      if (mis <= max) {
        bestMis = mis;
        best = { dx: ox - HALL_X0, dy: oy - HALL_Y0 };
      }
    }
  }
  return best === null ? null : { ...best, match: 1 - bestMis / total };
}

const HALF_COLS: readonly (readonly [number, number])[] = [[0, 40], [42, 82]];

const HALF_MATCH = 0.94;
const HALF_DX_APART = 2;

const HALF_SAMPLE_MIN = 0.8;
type HalfPattern = { x0: number; w: number; cls: Uint8Array; sx: Int32Array; sy: Int32Array; sc: Uint8Array };

function columnsPattern(c0: number, c1: number): HalfPattern {
  const w = c1 - c0 + 1;
  const cls = new Uint8Array(w * HALL_H);
  for (let y = 0; y < HALL_H; y++) for (let x = 0; x < w; x++) cls[y * w + x] = hallClasses[y * HALL_W + c0 + x];

  const at: number[] = [];
  let nonAir = 0;
  let air = 0;
  for (let i = 0; i < cls.length; i++) {
    if (cls[i] !== 0) {
      if (nonAir++ % 10 === 0) at.push(i);
    } else if (air++ % 60 === 0) at.push(i);
  }
  return { x0: HALL_X0 + c0, w, cls, sx: Int32Array.from(at, (i) => i % w), sy: Int32Array.from(at, (i) => Math.trunc(i / w)), sc: Uint8Array.from(at, (i) => cls[i]) };
}
const halfPatterns: HalfPattern[] = HALF_COLS.map(([c0, c1]) => columnsPattern(c0, c1));

const SIDE_COLS: readonly [number, number] = [54, 82];

const SIDE_MATCH = 0.95;
const sidePattern: HalfPattern = columnsPattern(SIDE_COLS[0], SIDE_COLS[1]);

type HalfScan = { p: HalfPattern; off: Int32Array; sampleLimit: number; limit: number };

function halfScan(p: HalfPattern, w: number, match = HALF_MATCH): HalfScan {
  const n = p.sc.length;
  const off = new Int32Array(n);
  for (let k = 0; k < n; k++) off[k] = p.sy[k] * w + p.sx[k];

  return { p, off, sampleLimit: Math.floor(n * (1 - HALF_SAMPLE_MIN) + 1e-9), limit: Math.floor(p.cls.length * (1 - match) + 1e-9) };
}

function halfMisAt(grid: Uint8Array, w: number, s: HalfScan, ox: number, oy: number): number {
  const p = s.p;
  const off = s.off;
  const sampleLimit = s.sampleLimit;
  const limit = s.limit;
  const base = oy * w + ox;
  let mis = 0;
  for (let k = 0; k < off.length && mis <= sampleLimit; k++) if (grid[base + off[k]] !== p.sc[k]) mis++;
  if (mis > sampleLimit) return -1;
  mis = 0;
  for (let y = 0; y < HALL_H && mis <= limit; y++) {
    const g = base + y * w;
    const r = y * p.w;
    for (let x = 0; x < p.w; x++) if (grid[g + x] !== p.cls[r + x]) mis++;
  }
  return mis <= limit ? mis : -1;
}

export function findHallHalves(col: Collision): { dxL: number; dxR: number; dy: number; matchL: number; matchR: number } | null {
  const w = col.width;
  const h = col.height;
  const [lp, rp] = halfPatterns;
  if (w < lp.w || h < HALL_H) return null;
  const grid = hallGrid(col);
  const ls = halfScan(lp, w);
  const rs = halfScan(rp, w);
  let best: { dxL: number; dxR: number; dy: number; misL: number; misR: number } | null = null;
  for (let oy = 0; oy + HALL_H <= h; oy++) {
    for (let ox = 0; ox + lp.w <= w; ox++) {
      const misL = halfMisAt(grid, w, ls, ox, oy);
      if (misL < 0) continue;
      const dxL = ox - lp.x0;
      for (let d = -HALF_DX_APART; d <= HALF_DX_APART; d++) {
        const rx = rp.x0 + dxL + d;
        if (d === 0 || rx < 0 || rx + rp.w > w) continue;
        const misR = halfMisAt(grid, w, rs, rx, oy);
        if (misR >= 0 && (best === null || misL + misR < best.misL + best.misR)) best = { dxL, dxR: dxL + d, dy: oy - HALL_Y0, misL, misR };
      }
    }
  }
  if (best === null) return null;
  return { dxL: best.dxL, dxR: best.dxR, dy: best.dy, matchL: 1 - best.misL / lp.cls.length, matchR: 1 - best.misR / rp.cls.length };
}

export function findRightSides(col: Collision): { dx: number; dy: number; match: number }[] {
  const w = col.width;
  const h = col.height;
  const p = sidePattern;
  if (w < p.w || h < HALL_H) return [];
  const grid = hallGrid(col);
  const s = halfScan(p, w, SIDE_MATCH);
  const found: { dx: number; dy: number; mis: number }[] = [];
  for (let oy = 0; oy + HALL_H <= h; oy++) {
    for (let ox = 0; ox + p.w <= w; ox++) {
      const mis = halfMisAt(grid, w, s, ox, oy);
      if (mis >= 0) found.push({ dx: ox - p.x0, dy: oy - HALL_Y0, mis });
    }
  }

  return found.sort((a, b) => a.mis - b.mis).map((f) => ({ dx: f.dx, dy: f.dy, match: 1 - f.mis / p.cls.length }));
}

export function findRightSide(col: Collision): { dx: number; dy: number; match: number } | null {
  return findRightSides(col)[0] ?? null;
}

function checkWb(def: WbDef, col: Collision, whole: boolean): boolean {
  for (const s of [def.left, def.right]) for (const p of s.spots) if (!standable(col, p.tx, p.ty)) return false;
  for (const c of def.crossings) {
    for (const a of c.anchors) if (!hookableAnchor(col, a.tx, a.ty)) return false;
    if (!whole) continue;
    if (!standable(col, c.start.tx, c.start.ty)) return false;
    for (const b of c.exit) {
      if (b.x0 < 0 || b.y0 < 0 || b.x1 >= col.width || b.y1 >= col.height) return false;
      for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) if (col.isFreeze(x * 32 + 16, y * 32 + 16) || col.isSolid(x * 32 + 16, y * 32 + 16)) return false;
    }
  }
  return true;
}

const sign = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

export function wayblockFor(mapName: string, col?: Collision): WbDef | null {
  const want = mapName.trim().toLowerCase();
  const def = WAYBLOCKS.find((d) => d.name.toLowerCase() === want);
  if (col === undefined) return def ?? null;
  if (def !== undefined && col.width === def.size.w && col.height === def.size.h && checkWb(def, col, false)) return checkWalls(def, col);
  const size = { w: col.width, h: col.height };
  const hall = findHallOffset(col);
  if (hall !== null) {
    const found = shiftDef(COPY_LOVE_BOX, `Copy Love Box hall at ${sign(hall.dx)},${sign(hall.dy)}`, hall.dx, hall.dy, size);
    return checkWb(found, col, true) ? checkWalls(found, col) : null;
  }

  const halves = findHallHalves(col);
  if (halves === null) return find2s(col, size);
  const { dxL, dxR, dy } = halves;
  const split = shiftSplitDef(COPY_LOVE_BOX, `Copy Love Box hall at ${sign(dxL)}/${sign(dxR)},${sign(dy)}`, dxL, dxR, dy, size);
  return checkWb(split, col, true) ? checkWalls(split, col) : null;
}

function find2s(col: Collision, size: { w: number; h: number }): WbDef | null {
  for (const side of findRightSides(col)) {
    const dx = side.dx;
    const dy = side.dy - CLB2S_DY;
    const tube = shiftBox(CLB2S_TUBE, dx, dy);
    if (tube.x0 < 0 || tube.y0 < 0 || tube.x1 >= col.width || tube.y1 >= col.height) continue;
    let frozen = true;
    for (let y = tube.y0; y <= tube.y1 && frozen; y++) for (let x = tube.x0; x <= tube.x1 && frozen; x++) frozen = col.isFreeze(x * 32 + 16, y * 32 + 16);
    if (!frozen) continue;
    const def = shift2s(`Copy Love Box 2s right hall at ${sign(side.dx)},${sign(side.dy)}`, dx, dy, size);
    if (checkWb(def, col, true)) return checkWalls(def, col);
  }
  return null;
}

function checkWalls(def: WbDef, col: Collision): WbDef {
  if (def.crossings.every((c) => c.wall === undefined || wallRouteOk(col, c))) return def;
  const strip = (sd: WbSideDef): WbSideDef => {
    if (sd.crossing.wall === undefined || wallRouteOk(col, sd.crossing)) return sd;
    const { wall: _gone, ...crossing } = sd.crossing;
    return { ...sd, crossing };
  };
  const left = strip(def.left);

  const right = def.right === def.left ? left : strip(def.right);
  return { ...def, left, right, crossings: left === right ? [left.crossing] : [left.crossing, right.crossing] };
}

export function sideDef(def: WbDef, s: WbSide): WbSideDef {
  return (def.oneSided ?? s) === "left" ? def.left : def.right;
}

const BOTH_SIDES: readonly WbSide[] = ["left", "right"];
export function wbSides(def: WbDef): readonly WbSide[] {
  return def.oneSided === undefined ? BOTH_SIDES : [def.oneSided];
}

export function wbMeasuredOn(mapName: string): boolean {
  const want = mapName.trim().toLowerCase();
  return WAYBLOCKS.some((d) => d.name.toLowerCase() === want) || want === COPY_LOVE_BOX_2S.name.toLowerCase();
}

export type WbGuardGeom = {
  shelf: TileBox;
  column: TileBox;
  landing: TileBox;
  foot: TileBox;
  passage: TileBox;
  corridor: TileBox;
  job: { tx: number; ty: number };
  stepOff: { tx: number; ty: number };
};
const guardGeoms = new WeakMap<WbSideDef, WbGuardGeom>();
export function wbGuardGeom(def: WbDef, s: WbSide): WbGuardGeom {
  const sd = sideDef(def, s);
  let g = guardGeoms.get(sd);
  if (g === undefined) {
    const o = sd.watch;
    const sign = (def.oneSided ?? s) === "left" ? 1 : -1;
    const X = (x: number): number => o.tx + sign * (x - 89);
    const Y = (y: number): number => o.ty + (y - 79);
    const box = (x0: number, y0: number, x1: number, y1: number): TileBox => ({ x0: Math.min(X(x0), X(x1)), y0: Y(y0), x1: Math.max(X(x0), X(x1)), y1: Y(y1) });
    g = {
      shelf: box(92, 81, 104, 84),
      column: box(93, 68, 104, 80),
      landing: box(85, 76, 92, 79),
      foot: box(85, 66, 92, 78),
      passage: box(85, 41, 92, 65),
      corridor: box(73, 70, 77, 88),
      job: { tx: X(91), ty: Y(79) },
      stepOff: { tx: X(86), ty: Y(79) },
    };
    guardGeoms.set(sd, g);
  }
  return g;
}

export function otherSide(s: WbSide): WbSide {
  return s === "left" ? "right" : "left";
}

export function sideAt(def: WbDef, tx: number, ty: number): WbSide | null {
  for (const s of wbSides(def)) {
    const d = sideDef(def, s);
    if (inAnyBox(d.zone, tx, ty) || inAnyBox(d.approach, tx, ty)) return s;
  }
  return null;
}

export function inWbZone(def: WbDef, s: WbSide, tx: number, ty: number): boolean {
  const d = sideDef(def, s);
  return inAnyBox(d.zone, tx, ty) || inAnyBox(d.approach, tx, ty);
}

export function inWbHall(def: WbDef, s: WbSide, tx: number, ty: number): boolean {
  return sideDef(def, s).zone.some((b) => tx >= b.x0 - WB_LEASH_TILES && tx <= b.x1 + WB_LEASH_TILES && ty >= b.y0 - WB_LEASH_TILES && ty <= b.y1 + WB_LEASH_TILES);
}

export function inWbLeash(def: WbDef, s: WbSide, tx: number, ty: number): boolean {
  return inAnyBox(sideDef(def, s).leash, tx, ty) && !inAnyBox(def.avoid, tx, ty);
}

export function wbWalkAllowed(def: WbDef | null, tx: number, ty: number): boolean {
  return def === null || !inAnyBox(def.avoid, tx, ty);
}

export const WB_SWITCH_MARGIN = 2;

export const WB_SIDE_HOPPING = false;

export const WB_PROVISIONAL_TICKS = 5 * 50;
export const WB_SWITCH_TICKS = 5 * 50;

export class WbSideChooser {
  side: WbSide | null = null;
  private pendingSince = -1;

  private provisional = false;
  private pickedAt = -1;

  reset(): void {
    this.side = null;
    this.pendingSince = -1;
    this.provisional = false;
    this.pickedAt = -1;
  }

  adopt(side: WbSide): void {
    this.side = side;
    this.provisional = false;
    this.pendingSince = -1;
  }

  update(counts: { left: number; right: number }, here: WbSide | null, tick: number, nearer: WbSide): WbSide {
    if (this.provisional && (here === this.side || tick < this.pickedAt || tick - this.pickedAt >= WB_PROVISIONAL_TICKS)) this.provisional = false;
    if (this.side === null || (this.provisional && counts.left + counts.right > 0)) {
      this.side = counts.left < counts.right ? "left" : counts.right < counts.left ? "right" : (here ?? nearer);
      this.provisional = counts.left + counts.right === 0;
      this.pickedAt = tick;
      this.pendingSince = -1;
      return this.side;
    }

    if (!WB_SIDE_HOPPING) return this.side;
    if (tick < this.pendingSince) this.pendingSince = tick;
    const cur = this.side;
    const other = otherSide(cur);
    const lead = counts[other] - counts[cur];

    const wants = here === other ? lead >= 0 : lead >= WB_SWITCH_MARGIN;
    if (!wants) {
      this.pendingSince = -1;
      return cur;
    }
    if (this.pendingSince < 0) this.pendingSince = tick;
    if (tick - this.pendingSince >= WB_SWITCH_TICKS) {
      this.side = other;
      this.pendingSince = -1;
    }
    return this.side;
  }
}
