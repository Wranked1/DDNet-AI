import { crc32 } from "node:zlib";
import { float32 } from "../core/float.ts";
import type { Collision } from "../core/collision.ts";
import {
  FLAT_ALIVE,
  FLAT_AMMO_0,
  FLAT_AMMO_1,
  FLAT_AMMO_2,
  FLAT_AMMO_3,
  FLAT_AMMO_4,
  FLAT_AMMO_5,
  FLAT_ANGLE,
  FLAT_COLLIDING,
  FLAT_CORE_MOVE_RESTRICTIONS,
  FLAT_DEEP_FROZEN,
  FLAT_DIRECTION,
  FLAT_ENDLESS_HOOK,
  FLAT_ENDLESS_JUMP,
  FLAT_FREEZE_END,
  FLAT_FREEZE_LEFT,
  FLAT_FREEZE_START,
  FLAT_FROZEN_LAST_TICK,
  FLAT_HAMMER_HIT_DISABLED,
  FLAT_HOOKED_PLAYER,
  FLAT_HOOK_DIR_X,
  FLAT_HOOK_DIR_Y,
  FLAT_HOOK_STATE,
  FLAT_HOOK_TELE_BASE_X,
  FLAT_HOOK_TELE_BASE_Y,
  FLAT_HOOK_TICK,
  FLAT_HOOK_X,
  FLAT_HOOK_Y,
  FLAT_IN_FREEZE,
  FLAT_JETPACK,
  FLAT_JUMPED,
  FLAT_JUMPED_TOTAL,
  FLAT_JUMPS,
  FLAT_LAST_REFILL_JUMPS,
  FLAT_LEFT_WALL,
  FLAT_LIVE_FROZEN,
  FLAT_MOVE_RESTRICTIONS,
  FLAT_NEW_HOOK,
  FLAT_POS_X,
  FLAT_POS_Y,
  FLAT_PREV_X,
  FLAT_PREV_Y,
  FLAT_QUEUED_WEAPON,
  FLAT_RELOAD,
  FLAT_RESPAWN_AT,
  FLAT_SPAWN_X,
  FLAT_SPAWN_Y,
  FLAT_STRIDE,
  FLAT_TELE_CHECKPOINT,
  FLAT_TICK,
  FLAT_VEL_X,
  FLAT_VEL_Y,
  FLAT_WEAPON,
  FLAT_WEAPON_GOT,
  SimWorld,
} from "../core/world.ts";
import { NUM_WEAPONS } from "../core/types.ts";
import { FREEZE_WAIT_OK_TICKS, judgeStates, landingsAt, teleportsIn } from "./goresJudge.ts";
import { JOIN_POS_PX, JOIN_VEL_PX, MAX_SECTION_TICKS, PHYSICS_VERSION, POLISH_PASSES, SOLUTION_VERSION, goresSource, joined } from "./goresMap.ts";
import type { CourseSource, MapSolution, SolvedSection } from "./goresMap.ts";
import { MACRO_TICKS, MACRO_WAIT, THROW_DIRS, goalReached, replayProgram } from "./pathfind.ts";

export const PACK_MAGIC = "GRP2";
export const PACK_MAX_BYTES = 2_000_000;
export const PACK_MAX_SECTIONS = 4096;
export const PACK_MAX_TICKS = 200_000;

export const PACK_VERIFY_MAX_TICKS = 20_000;

export const PACK_VERSION = SOLUTION_VERSION;

export const WAIT_MAX_TICKS = 300;
const WAIT_MARK = 0xffff;
const HEADER_BYTES = 48;
const SECTION_FIXED_BYTES = 16 + 3 + 2 * 8 * FLAT_STRIDE + 4;
const FLAG_TELE = 1;
const KEY_RE = /^[0-9a-f]{32}$/;

const MIN_CUT = 4;

export const END_POS_TOL = JOIN_POS_PX;
export const END_VEL_TOL = JOIN_VEL_PX;

const POS_MAX = 1 << 20;
const SPEED_MAX = 1000;
const MAP_MARGIN_PX = 128;
const FLAT_ABS_MAX = 2 ** 40;
const TIMER_MAX = 2 ** 31;

const DIR_MAX = 1.01;

type Bound = { lo: number; hi: number; int: boolean };
const FIELD_BOUNDS: (Bound | undefined)[] = new Array<Bound | undefined>(FLAT_STRIDE).fill(undefined);
const bound = (field: number, lo: number, hi: number, int = true): void => {
  FIELD_BOUNDS[field] = { lo, hi, int };
};
for (const f of [FLAT_LEFT_WALL, FLAT_IN_FREEZE, FLAT_NEW_HOOK, FLAT_DEEP_FROZEN, FLAT_FROZEN_LAST_TICK, FLAT_ENDLESS_HOOK, FLAT_HAMMER_HIT_DISABLED, FLAT_LIVE_FROZEN, FLAT_ENDLESS_JUMP, FLAT_JETPACK, FLAT_LAST_REFILL_JUMPS]) bound(f, 0, 1);

bound(FLAT_ALIVE, 1, 1);
for (const f of [FLAT_TICK, FLAT_FREEZE_START, FLAT_FREEZE_END, FLAT_FREEZE_LEFT, FLAT_RELOAD, FLAT_JUMPED_TOTAL]) bound(f, 0, TIMER_MAX);

bound(FLAT_HOOK_TICK, -TIMER_MAX, TIMER_MAX);

bound(FLAT_RESPAWN_AT, -1, TIMER_MAX);

bound(FLAT_HOOK_STATE, -1, 5);

bound(FLAT_HOOKED_PLAYER, -1, -1);
bound(FLAT_JUMPED, 0, 3);
bound(FLAT_DIRECTION, -1, 1);
bound(FLAT_COLLIDING, 0, 2);

bound(FLAT_ANGLE, -4096, 4096);
bound(FLAT_CORE_MOVE_RESTRICTIONS, 0, 1023);
bound(FLAT_MOVE_RESTRICTIONS, 0, 1023);

bound(FLAT_TELE_CHECKPOINT, 0, 255);
bound(FLAT_JUMPS, -1, 255);
bound(FLAT_WEAPON, -1, NUM_WEAPONS - 1);
bound(FLAT_QUEUED_WEAPON, -1, NUM_WEAPONS - 1);
bound(FLAT_WEAPON_GOT, 0, (1 << NUM_WEAPONS) - 1);

for (const f of [FLAT_AMMO_0, FLAT_AMMO_1, FLAT_AMMO_2, FLAT_AMMO_3, FLAT_AMMO_4, FLAT_AMMO_5]) bound(f, -1, TIMER_MAX);
for (const f of [FLAT_HOOK_DIR_X, FLAT_HOOK_DIR_Y]) bound(f, -DIR_MAX, DIR_MAX, false);
for (const f of [FLAT_VEL_X, FLAT_VEL_Y]) bound(f, -SPEED_MAX, SPEED_MAX, false);

type Place = { axis: 0 | 1; tee: boolean };
const PLACES: (Place | undefined)[] = new Array<Place | undefined>(FLAT_STRIDE).fill(undefined);
for (const [f, axis, tee] of [
  [FLAT_POS_X, 0, true],
  [FLAT_POS_Y, 1, true],
  [FLAT_PREV_X, 0, true],
  [FLAT_PREV_Y, 1, true],
  [FLAT_HOOK_X, 0, false],
  [FLAT_HOOK_Y, 1, false],
  [FLAT_HOOK_TELE_BASE_X, 0, false],
  [FLAT_HOOK_TELE_BASE_Y, 1, false],
  [FLAT_SPAWN_X, 0, false],
  [FLAT_SPAWN_Y, 1, false],
] as [number, 0 | 1, boolean][]) PLACES[f] = { axis, tee };

export const RANGED_FIELDS: ReadonlySet<number> = new Set<number>([...FIELD_BOUNDS.flatMap((b, f) => (b === undefined ? [] : [f])), ...PLACES.flatMap((p, f) => (p === undefined ? [] : [f]))]);

export function stateWhy(st: Float64Array, col?: Collision): string | null {
  if (st.length !== FLAT_STRIDE) return "state of the wrong size";
  for (let i = 0; i < FLAT_STRIDE; i++) {
    const v = st[i];
    if (!Number.isFinite(v) || Math.abs(v) > FLAT_ABS_MAX) return "state with a number out of range";
  }
  for (let f = 0; f < FLAT_STRIDE; f++) {
    const v = st[f];
    const place = PLACES[f];
    if (place !== undefined) {
      const size = col === undefined ? POS_MAX : (place.axis === 0 ? col.width : col.height) * 32;
      const margin = col === undefined || place.tee ? 0 : MAP_MARGIN_PX;
      const lo = place.tee ? 0 : col === undefined ? -POS_MAX : -margin;
      if (v < lo || v > size + margin) return place.tee ? "state with a position off the map" : "state with a rope or spawn point off the map";
      continue;
    }
    const b = FIELD_BOUNDS[f];
    if (b === undefined) continue;
    if (v < b.lo || v > b.hi || (b.int && !Number.isInteger(v))) {
      if (f === FLAT_VEL_X || f === FLAT_VEL_Y) return "state with an absurd speed";
      if (f === FLAT_HOOK_DIR_X || f === FLAT_HOOK_DIR_Y) return "state with a rope direction that is none";
      return b.hi === TIMER_MAX ? "state with a timer or a count out of range" : "state with a field out of its range";
    }
  }
  return null;
}

function edgeWhy(code: number, ticks: number): string | null {
  if (!Number.isInteger(code) || !Number.isInteger(ticks)) return "program has a non-integer";
  if (code === MACRO_WAIT) return ticks >= 1 && ticks <= WAIT_MAX_TICKS ? null : "wait of bad length";
  if (code < 0 || code >= 1 << 12) return "macro code out of range";
  if ((code & 3) > 2) return "macro with a bad direction";
  const hook = (code >> 3) & 7;
  if (hook > 3) return "macro with a bad rope action";
  const ang = code >> 6;
  if (ang >= THROW_DIRS || (hook !== 2 && ang !== 0)) return "macro with a bad throw angle";
  return ticks >= 1 && ticks <= MACRO_TICKS ? null : "macro of bad length";
}

const hexOfKey = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

const polishOf = (sol: MapSolution): number => {
  const p = sol.polish ?? 0;
  if (!Number.isInteger(p) || p < 0 || p > 255) throw new Error("pack: polish");
  return p;
};

export function encodePack(sol: MapSolution): Uint8Array {
  if (!KEY_RE.test(sol.key)) throw new Error("pack: key is not 32 hex digits");
  if (sol.version !== PACK_VERSION || sol.physicsVersion !== PHYSICS_VERSION) throw new Error("pack: another version of the solution or of the physics");
  const polish = polishOf(sol);
  const secs = sol.sections;
  if (secs.length < 1 || secs.length > PACK_MAX_SECTIONS) throw new Error(`pack: ${secs.length} sections`);
  let size = HEADER_BYTES + 4;
  let ticksAll = 0;
  for (let i = 0; i < secs.length; i++) {
    const s = secs[i];
    if (s.idx !== i) throw new Error("pack: sections are not numbered by position");
    if (s.codes.length !== s.edgeTicks.length || s.codes.length < 1) throw new Error("pack: program of codes and ticks that do not pair");
    let n = 0;
    let bytes = 0;
    for (let e = 0; e < s.codes.length; e++) {
      const why = edgeWhy(s.codes[e], s.edgeTicks[e]);
      if (why !== null) throw new Error(`pack: ${why}`);
      n += s.edgeTicks[e];
      bytes += s.codes[e] === MACRO_WAIT ? 4 : 2;
    }
    if (n !== s.ticks) throw new Error("pack: ticks do not add up");
    for (const st of [s.startState, s.endState]) {
      const why = stateWhy(st);
      if (why !== null) throw new Error(`pack: ${why}`);
    }
    ticksAll += n;
    size += SECTION_FIXED_BYTES + bytes;
  }
  if (ticksAll > PACK_MAX_TICKS || size > PACK_MAX_BYTES) throw new Error("pack: too big");
  if (!Number.isSafeInteger(sol.attempts) || sol.attempts < 0) throw new Error("pack: attempts");
  if (sol.bestTicks !== ticksAll) throw new Error("pack: best ticks are not the sections'");

  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  let p = 0;
  for (let i = 0; i < 4; i++) out[p++] = PACK_MAGIC.charCodeAt(i);
  dv.setUint16(p, sol.version, true);
  p += 2;
  dv.setUint16(p, sol.physicsVersion, true);
  p += 2;
  for (let i = 0; i < 16; i++) out[p++] = parseInt(sol.key.slice(i * 2, i * 2 + 2), 16);
  dv.setUint16(p, sol.cutEvery, true);
  p += 2;
  dv.setUint32(p, sol.total, true);
  p += 4;
  out[p++] = sol.complete ? 1 : 0;
  dv.setUint32(p, sol.bestTicks, true);
  p += 4;
  dv.setFloat64(p, sol.attempts, true);
  p += 8;
  out[p++] = polish;
  dv.setUint32(p, secs.length, true);
  p += 4;
  for (const s of secs) {
    dv.setUint32(p, s.idx, true);
    dv.setUint32(p + 4, s.from, true);
    dv.setUint32(p + 8, s.to, true);
    dv.setUint32(p + 12, s.ticks, true);
    p += 16;
    out[p++] = Math.max(0, Math.min(255, Math.round(s.ahead)));
    out[p++] = Math.round(Math.max(0, Math.min(1, s.copiesHeld)) * 255);
    out[p++] = s.tele === true ? FLAG_TELE : 0;
    for (const st of [s.startState, s.endState]) for (let i = 0; i < FLAT_STRIDE; i++, p += 8) dv.setFloat64(p, st[i], true);
    dv.setUint32(p, s.codes.length, true);
    p += 4;
    for (let e = 0; e < s.codes.length; e++) {
      if (s.codes[e] === MACRO_WAIT) {
        dv.setUint16(p, WAIT_MARK, true);
        dv.setUint16(p + 2, s.edgeTicks[e], true);
        p += 4;
      } else {
        dv.setUint16(p, s.codes[e] | ((s.edgeTicks[e] - 1) << 12), true);
        p += 2;
      }
    }
  }
  dv.setUint32(p, crc32(out.subarray(0, p)), true);

  const back = parsePack(out, sol.key);
  if (!back.ok) throw new Error(`pack: the pack written does not read back (${back.why})`);
  if (back.sol.sections.length !== secs.length || (back.sol.polish ?? 0) !== polish) throw new Error("pack: the pack written reads back as another route");
  for (let i = 0; i < secs.length; i++) {
    const a = secs[i];
    const b = back.sol.sections[i];
    const same =
      a.codes.length === b.codes.length &&
      a.codes.every((c, e) => c === b.codes[e] && a.edgeTicks[e] === b.edgeTicks[e]) &&
      (a.tele === true) === (b.tele === true) &&
      a.idx === b.idx &&
      a.from === b.from &&
      a.to === b.to &&
      a.ticks === b.ticks &&
      a.startState.every((v, f) => v === b.startState[f]) &&
      a.endState.every((v, f) => v === b.endState[f]);
    if (!same) throw new Error(`pack: section ${i} reads back as another section`);
  }
  return out;
}

class PackError extends Error {}
const bad = (why: string): never => {
  throw new PackError(why);
};

class Reader {
  readonly b: Uint8Array;
  readonly end: number;
  readonly dv: DataView;
  p = 0;
  constructor(b: Uint8Array, end: number) {
    this.b = b;
    this.end = end;
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  need(n: number): void {
    if (n < 0 || this.p + n > this.end) bad("truncated");
  }
  u8(): number {
    this.need(1);
    return this.b[this.p++];
  }
  u16(): number {
    this.need(2);
    const v = this.dv.getUint16(this.p, true);
    this.p += 2;
    return v;
  }
  u32(): number {
    this.need(4);
    const v = this.dv.getUint32(this.p, true);
    this.p += 4;
    return v;
  }
  f64(): number {
    this.need(8);
    const v = this.dv.getFloat64(this.p, true);
    this.p += 8;
    return v;
  }
  state(): Float64Array {
    this.need(8 * FLAT_STRIDE);
    const st = new Float64Array(FLAT_STRIDE);
    for (let i = 0; i < FLAT_STRIDE; i++) st[i] = this.f64();
    const why = stateWhy(st);
    if (why !== null) bad(why);
    return st;
  }
}

export function parsePack(bytes: Uint8Array, expectKey: string): { ok: true; sol: MapSolution } | { ok: false; why: string } {
  try {
    if (!(bytes instanceof Uint8Array)) return { ok: false, why: "not bytes" };
    if (!KEY_RE.test(expectKey)) return { ok: false, why: "bad expected key" };
    const n = bytes.length;
    if (n > PACK_MAX_BYTES) return { ok: false, why: "pack too big" };
    if (n < HEADER_BYTES + SECTION_FIXED_BYTES + 2 + 4) return { ok: false, why: "pack too short" };
    for (let i = 0; i < 4; i++) if (bytes[i] !== PACK_MAGIC.charCodeAt(i)) return { ok: false, why: "bad magic" };
    const r = new Reader(bytes, n - 4);
    if (r.dv.getUint32(n - 4, true) !== crc32(bytes.subarray(0, n - 4))) return { ok: false, why: "bad checksum" };
    r.p = 4;
    const version = r.u16();
    if (version !== PACK_VERSION) return { ok: false, why: `unknown version ${version}` };
    const physicsVersion = r.u16();
    if (physicsVersion !== PHYSICS_VERSION) return { ok: false, why: `physics version ${physicsVersion}` };
    r.need(16);
    const key = hexOfKey(bytes.subarray(r.p, r.p + 16));
    r.p += 16;
    if (key !== expectKey) return { ok: false, why: "pack is for another map" };
    const cutEvery = r.u16();
    if (cutEvery < MIN_CUT) return { ok: false, why: "bad cut" };
    const total = r.u32();
    if (total < 1 || total > PACK_MAX_SECTIONS) return { ok: false, why: "bad section total" };
    const complete = r.u8();
    if (complete > 1) return { ok: false, why: "bad complete flag" };
    const bestTicks = r.u32();
    if (bestTicks > PACK_MAX_TICKS) return { ok: false, why: "bad best ticks" };
    const attempts = r.f64();
    if (!Number.isSafeInteger(attempts) || attempts < 0) return { ok: false, why: "bad attempts" };
    const polish = r.u8();
    const count = r.u32();
    if (count < 1 || count > PACK_MAX_SECTIONS || count > total) return { ok: false, why: "bad section count" };

    if (count * (SECTION_FIXED_BYTES + 2) > r.end - r.p) return { ok: false, why: "truncated" };

    const sections: SolvedSection[] = [];
    let ticksAll = 0;
    for (let i = 0; i < count; i++) {
      const idx = r.u32();
      const from = r.u32();
      const to = r.u32();
      const ticks = r.u32();
      const ahead = r.u8();
      const copies = r.u8();
      const flags = r.u8();
      if (idx !== i) return { ok: false, why: "sections out of order" };
      if (to >= 1 << 24 || from > to) return { ok: false, why: "bad section indices" };
      if (i > 0 && from < sections[i - 1].to) return { ok: false, why: "sections out of order" };
      if ((flags & ~FLAG_TELE) !== 0) return { ok: false, why: "bad section flags" };
      if (ticks < 1 || ticks > PACK_MAX_TICKS - ticksAll) return { ok: false, why: "too many ticks" };
      const startState = r.state();
      const endState = r.state();
      const macros = r.u32();

      if (macros < 1 || macros > ticks || macros * 2 > r.end - r.p) return { ok: false, why: "bad macro count" };
      const codes: number[] = [];
      const edgeTicks: number[] = [];
      let sum = 0;
      for (let e = 0; e < macros; e++) {
        const v = r.u16();
        let code: number;
        let t: number;
        if (v === WAIT_MARK) {
          code = MACRO_WAIT;
          t = r.u16();
        } else {
          if (v >= 1 << 14) return { ok: false, why: "bad macro" };
          code = v & 0xfff;
          t = (v >> 12) + 1;
        }
        const why = edgeWhy(code, t);
        if (why !== null) return { ok: false, why };
        sum += t;
        if (sum > ticks) return { ok: false, why: "program longer than its ticks" };
        codes.push(code);
        edgeTicks.push(t);
      }
      if (sum !== ticks) return { ok: false, why: "program shorter than its ticks" };
      ticksAll += ticks;
      sections.push({ idx, from, to, startState, codes, edgeTicks, inputs: [], endState, ticks, ahead, copiesHeld: copies / 255, ...((flags & FLAG_TELE) !== 0 ? { tele: true as const } : {}) });
    }
    if (r.p !== r.end) return { ok: false, why: "trailing bytes" };
    if (bestTicks !== ticksAll) return { ok: false, why: "best ticks are not the sections'" };
    return { ok: true, sol: { version, physicsVersion, key, cutEvery, sections, solvedPrefix: sections.length, total, complete: complete === 1, bestTicks, attempts, polish } };
  } catch (err) {
    return { ok: false, why: err instanceof PackError ? err.message : "unreadable pack" };
  }
}

function stateDiff(a: Float64Array, ao: number, b: Float64Array): number {
  for (let f = 0; f < FLAT_STRIDE; f++) {
    const x = a[ao + f];
    const y = b[f];
    if (f === FLAT_POS_X || f === FLAT_POS_Y) {
      if (Math.abs(x - y) > END_POS_TOL) return f;
    } else if (f === FLAT_VEL_X || f === FLAT_VEL_Y) {
      if (Math.abs(x - y) > END_VEL_TOL) return f;
    } else if (x !== y) return f;
  }
  return -1;
}

export const FLOAT_OFF_WHY = "the float physics are off (core/float.ts setFloat32)";

export type PackVerdict = { ok: true; sol: MapSolution } | { ok: false; firstBadSection: number; why: string };

export function verifyPack(col: Collision, sol: MapSolution, source?: CourseSource | null): PackVerdict {
  let at = 0;
  try {
    if (!float32) return { ok: false, firstBadSection: 0, why: FLOAT_OFF_WHY };
    if (sol.version !== PACK_VERSION || sol.physicsVersion !== PHYSICS_VERSION) return { ok: false, firstBadSection: 0, why: "another version of the solution or of the physics" };
    const secs = sol.sections;
    if (secs.length < 1 || secs.length > PACK_MAX_SECTIONS) return { ok: false, firstBadSection: 0, why: "bad section count" };
    if (!Number.isInteger(sol.cutEvery) || sol.cutEvery < MIN_CUT) return { ok: false, firstBadSection: 0, why: "bad cut" };
    const src = source === undefined ? goresSource(col) : source;
    if (src === null) return { ok: false, firstBadSection: 0, why: "this map has no gores course" };
    const lastPath = src.course.path.length - 1;
    const teles = new Set(src.course.teles);

    let ticksAll = 0;
    for (let i = 0; i < secs.length; i++) {
      at = i;
      const s = secs[i];
      if (s.idx !== i) return { ok: false, firstBadSection: i, why: "sections are not numbered by position" };
      if (s.codes.length !== s.edgeTicks.length || s.codes.length < 1) return { ok: false, firstBadSection: i, why: "program of codes and ticks that do not pair" };
      let sum = 0;
      for (let e = 0; e < s.codes.length; e++) {
        const why = edgeWhy(s.codes[e], s.edgeTicks[e]);
        if (why !== null) return { ok: false, firstBadSection: i, why };
        sum += s.edgeTicks[e];
      }
      if (sum !== s.ticks) return { ok: false, firstBadSection: i, why: "ticks do not add up" };

      if (s.ticks > MAX_SECTION_TICKS) return { ok: false, firstBadSection: i, why: "a section longer than any the solver writes" };
      if (s.ticks % 2 !== 0 && !(i === secs.length - 1 && sol.complete === true)) return { ok: false, firstBadSection: i, why: "a section of an odd tick count before the end" };
      ticksAll += sum;
      if (ticksAll > PACK_VERIFY_MAX_TICKS) return { ok: false, firstBadSection: i, why: "too long a route to verify here" };
      const why = stateWhy(s.startState, col) ?? stateWhy(s.endState, col);
      if (why !== null) return { ok: false, firstBadSection: i, why };
      if (!Number.isInteger(s.from) || !Number.isInteger(s.to) || s.from < 0 || s.from > s.to || s.to > lastPath) return { ok: false, firstBadSection: i, why: "section outside the course" };
      if (i > 0 && !joined(secs[i - 1], s)) return { ok: false, firstBadSection: i, why: "section does not begin where the one before ends on the course" };
      if (s.tele !== undefined && (s.tele !== true || !teles.has(s.to))) return { ok: false, firstBadSection: i, why: "a teleport section that does not end on a teleporter's exit" };
    }
    at = 0;

    const first = src.cut(sol.cutEvery, 0)[0];
    if (first === undefined || secs[0].from !== first.from) return { ok: false, firstBadSection: 0, why: "the route does not begin where the course does" };

    if (stateDiff(src.spawn, 0, secs[0].startState) >= 0) return { ok: false, firstBadSection: 0, why: "the route does not begin in the course's own start state" };

    const sim = new SimWorld(col, { respawnDelayTicks: 1_000_000, pickups: true });
    sim.addTee(0, { x: 0, y: 0 });
    const out: SolvedSection[] = [];

    let cur: Float64Array = src.spawn.slice();
    let lastStates: Float64Array = cur;
    for (let i = 0; i < secs.length; i++) {
      at = i;
      const s = secs[i];
      if (i > 0 && stateDiff(cur, 0, s.startState) >= 0) return { ok: false, firstBadSection: i, why: "section does not start where the replay of the one before ends" };
      const from = cur;
      const run = replayProgram(sim, from, s.codes, s.edgeTicks);
      if (run.ticks !== s.ticks) return { ok: false, firstBadSection: i, why: "replay has another tick count" };
      const endAt = s.ticks * FLAT_STRIDE;
      if (stateDiff(run.states, endAt, s.endState) >= 0) return { ok: false, firstBadSection: i, why: "replay ends elsewhere than stored" };

      const j = judgeStates(col, run.states, s.ticks, s.tele === true ? 1 : 0, FREEZE_WAIT_OK_TICKS);
      if (!j.ok) return { ok: false, firstBadSection: i, why: j.why };

      if (i < secs.length - 1 && run.states[endAt + FLAT_FREEZE_LEFT] > 0) return { ok: false, firstBadSection: i, why: "a section that ends frozen" };
      if (s.tele === true) {

        const exit = src.course.path[s.to];
        const ex = (exit % col.width) * 32 + 16;
        const ey = Math.floor(exit / col.width) * 32 + 16;
        if (teleportsIn(run.states, s.ticks) > 1 || landingsAt(run.states, s.ticks, ex, ey) !== 1) return { ok: false, firstBadSection: i, why: "a teleport section that does not land on its exit" };
      }
      cur = run.states.slice(endAt, endAt + FLAT_STRIDE);
      lastStates = run.states;

      out.push({ ...s, codes: [...s.codes], edgeTicks: [...s.edgeTicks], startState: from.slice(), endState: cur.slice(), inputs: run.inputs });
    }

    const lastSec = secs[secs.length - 1];
    at = secs.length - 1;
    if (sol.bestTicks !== ticksAll) return { ok: false, firstBadSection: at, why: "the header's best ticks are not the ticks of the replay" };
    if (sol.solvedPrefix !== secs.length) return { ok: false, firstBadSection: at, why: "the header's solved prefix is not the sections" };
    let complete = false;
    if (lastSec.to === lastPath) {
      const goal = src.goal({ idx: lastSec.idx, label: "pack", from: lastSec.from, to: lastSec.to, tiles: 0, ...(lastSec.tele === true ? { tele: true as const } : {}) });
      for (let t = 1; t <= lastSec.ticks && !complete; t++) {
        const o = t * FLAT_STRIDE;
        complete = goalReached(col, goal, lastStates[o + FLAT_POS_X], lastStates[o + FLAT_POS_Y], lastStates[o + FLAT_VEL_X], lastStates[o + FLAT_FREEZE_LEFT] > 0);
      }
    }
    if (sol.complete !== complete) return { ok: false, firstBadSection: at, why: complete ? "the route reaches the finish, the header says it does not" : "the header says the route reaches the finish, the replay does not" };

    const polish = Math.min(sol.polish ?? 0, POLISH_PASSES.length);
    return { ok: true, sol: { ...sol, sections: out, solvedPrefix: out.length, bestTicks: ticksAll, complete, polish } };
  } catch (err) {
    return { ok: false, firstBadSection: at, why: `replay failed: ${err instanceof Error ? err.message : "error"}` };
  }
}
