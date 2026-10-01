import type { Collision } from "../core/collision.ts";
import { TILE_DEATH, TILE_FREEZE, TILE_NOHOOK, TILE_SOLID } from "../core/tuning.ts";
import type { Crossing, TileBox } from "./crossing.ts";
import { inAnyBox, shiftBox, shiftCrossing } from "./crossing.ts";

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
};

const L1: TileBox = { x0: 79, y0: 67, x1: 104, y1: 79 };
const L2: TileBox = { x0: 78, y0: 79, x1: 104, y1: 87 };
const LEFT_APPROACH: TileBox = { x0: 84, y0: 41, x1: 103, y1: 66 };

const LEFT_SPOTS = [{ tx: 94, ty: 84 }, { tx: 82, ty: 79 }, { tx: 101, ty: 84 }];

const RIGHT_SPOTS = [{ tx: 152, ty: 79 }, { tx: MIRROR - 94, ty: 84 }, { tx: MIRROR - 101, ty: 84 }];

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

export const WAYBLOCKS: readonly WbDef[] = [COPY_LOVE_BOX, shiftDef(COPY_LOVE_BOX, "Copy Love Box JoniTee", 182, 212, { w: 600, h: 600 })];

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

export function findHallOffset(col: Collision): { dx: number; dy: number; match: number } | null {
  const w = col.width;
  const h = col.height;
  if (w < HALL_W || h < HALL_H) return null;
  const tiles = col.tiles;
  const grid = new Uint8Array(w * h);
  for (let i = 0; i < grid.length; i++) {
    const t = tiles[i];
    grid[i] = t === TILE_SOLID || t === TILE_NOHOOK ? 1 : t === TILE_FREEZE ? 2 : t === TILE_DEATH ? 3 : 0;
  }
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

function checkWb(def: WbDef, col: Collision, whole: boolean): boolean {
  for (const s of [def.left, def.right]) for (const p of s.spots) if (!standable(col, p.tx, p.ty)) return false;
  for (const c of def.crossings) {
    for (const a of c.anchors) {
      if (a.tx < 0 || a.ty < 0 || a.tx >= col.width || a.ty >= col.height) return false;
      const x = a.tx * 32 + 16;
      const y = a.ty * 32 + 16;
      if (!col.isSolid(x, y) || col.isNoHook(x, y)) return false;
    }
    if (!whole) continue;
    if (!standable(col, c.start.tx, c.start.ty)) return false;
    for (const b of c.exit) {
      if (b.x0 < 0 || b.y0 < 0 || b.x1 >= col.width || b.y1 >= col.height) return false;
      for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) if (col.isFreeze(x * 32 + 16, y * 32 + 16) || col.isSolid(x * 32 + 16, y * 32 + 16)) return false;
    }
  }
  return true;
}

export function wayblockFor(mapName: string, col?: Collision): WbDef | null {
  const want = mapName.trim().toLowerCase();
  const def = WAYBLOCKS.find((d) => d.name.toLowerCase() === want);
  if (col === undefined) return def ?? null;
  if (def !== undefined && col.width === def.size.w && col.height === def.size.h && checkWb(def, col, false)) return def;
  const hall = findHallOffset(col);
  if (hall === null) return null;
  const sign = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);
  const found = shiftDef(COPY_LOVE_BOX, `Copy Love Box hall at ${sign(hall.dx)},${sign(hall.dy)}`, hall.dx, hall.dy, { w: col.width, h: col.height });
  return checkWb(found, col, true) ? found : null;
}

export function sideDef(def: WbDef, s: WbSide): WbSideDef {
  return s === "left" ? def.left : def.right;
}

export function otherSide(s: WbSide): WbSide {
  return s === "left" ? "right" : "left";
}

export function sideAt(def: WbDef, tx: number, ty: number): WbSide | null {
  for (const s of ["left", "right"] as const) {
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
