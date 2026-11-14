import { closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";
import { FLAT_STRIDE } from "../core/world.ts";
import { PHYSICS_VERSION, POLISH_PASSES, SOLUTION_VERSION, MAX_SECTION_TICKS } from "../plan/goresMap.ts";
import type { MapSolution, SolvedSection } from "../plan/goresMap.ts";
import { writeJsonAtomic } from "./atomicWrite.ts";

const MAX_FILE_BYTES = 16 * 1024 * 1024;
const INPUT_KEYS = ["direction", "targetX", "targetY", "jump", "fire", "hook", "playerFlags", "wantedWeapon", "nextWeapon", "prevWeapon"] as const;
const KEY_OK = /^[A-Za-z0-9_.-]{1,120}$/;

const f64Out = (_key: string, value: unknown): unknown => (value instanceof Float64Array ? { f64: Array.from(value) } : value);

export function encodeSolution(sol: MapSolution): string {
  return JSON.stringify(sol, f64Out);
}

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isInt = (x: unknown): x is number => isNum(x) && Number.isInteger(x);
const isIdx = (x: unknown): x is number => isInt(x) && x >= 0;
const isArr = (x: unknown): x is unknown[] => Array.isArray(x);
const isState = (x: unknown): x is Float64Array => x instanceof Float64Array && x.length === FLAT_STRIDE && x.every(Number.isFinite);

const isInput = (x: unknown): boolean => typeof x === "object" && x !== null && INPUT_KEYS.every((k) => isInt((x as Record<string, unknown>)[k]));

function validSection(s: unknown, position: number): s is SolvedSection {
  if (typeof s !== "object" || s === null) return false;
  const o = s as Record<string, unknown>;
  return (
    o.idx === position &&
    isIdx(o.from) &&
    isIdx(o.to) &&
    o.from <= o.to &&
    isState(o.startState) &&
    isState(o.endState) &&
    isArr(o.codes) &&
    o.codes.every(isInt) &&
    isArr(o.edgeTicks) &&
    isIdx(o.ticks) &&
    o.ticks <= MAX_SECTION_TICKS &&

    o.edgeTicks.every((e) => isIdx(e) && e <= (o.ticks as number)) &&
    o.codes.length === o.edgeTicks.length &&
    isArr(o.inputs) &&
    o.inputs.length === o.ticks &&
    o.inputs.every(isInput) &&
    isNum(o.ahead) &&
    isNum(o.copiesHeld) &&

    o.copiesHeld >= 0 &&
    o.copiesHeld <= 1 &&
    (o.tele === undefined || o.tele === true)
  );
}

export function decodeSolution(text: string): MapSolution | null {
  try {
    return solutionOf(parseF64(text));
  } catch {
    return null;
  }
}

function parseF64(text: string): unknown {
  return JSON.parse(text, (_key, value: unknown) => {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const keys = Object.keys(value);
      const f64 = (value as { f64?: unknown }).f64;

      if (keys.length === 1 && keys[0] === "f64" && isArr(f64) && f64.every((v) => typeof v === "number" && Number.isFinite(v))) return Float64Array.from(f64 as number[]);
    }
    return value;
  });
}

function solutionOf(raw: unknown): MapSolution | null {
  try {
    if (typeof raw !== "object" || raw === null) return null;
    const o = raw as Record<string, unknown>;
    if (o.version !== SOLUTION_VERSION || o.physicsVersion !== PHYSICS_VERSION) return null;
    if (typeof o.key !== "string" || !isNum(o.cutEvery) || !isArr(o.sections)) return null;
    if (!o.sections.every((sec, i) => validSection(sec, i))) return null;
    if (o.solvedPrefix !== o.sections.length || !isIdx(o.total) || o.total < o.solvedPrefix) return null;
    if (typeof o.complete !== "boolean" || !isNum(o.bestTicks) || !isNum(o.attempts)) return null;

    if (o.polish !== undefined && !isIdx(o.polish)) return null;
    return raw as MapSolution;
  } catch {
    return null;
  }
}

export function solutionWrittenMs(dir: string, key: string): number | null {
  try {
    if (!KEY_OK.test(key)) return null;
    const file = join(dir, `${key}.json`);
    return existsSync(file) ? statSync(file).mtimeMs : null;
  } catch {
    return null;
  }
}

export function loadSolution(dir: string, key: string): MapSolution | null {
  try {
    if (!KEY_OK.test(key)) return null;
    const file = join(dir, `${key}.json`);
    if (!existsSync(file) || statSync(file).size > MAX_FILE_BYTES) return null;
    const sol = decodeSolution(readFileSync(file, "utf8"));
    return sol !== null && sol.key === key ? sol : null;
  } catch {
    return null;
  }
}

export function saveSolution(dir: string, key: string, sol: MapSolution): boolean {
  try {
    if (!KEY_OK.test(key)) return false;
    mkdirSync(dir, { recursive: true });
    writeJsonAtomic(join(dir, `${key}.json`), encodeSolution(sol));
    return true;
  } catch {
    return false;
  }
}

export function solutionFileState(dir: string, key: string): { at: number; size: number } | null {
  try {
    if (!KEY_OK.test(key)) return null;
    const st = statSync(join(dir, `${key}.json`));
    return { at: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
}

export function savePolishPartial(dir: string, key: string, partial: { pass: number; sol: MapSolution }): void {
  try {
    if (!KEY_OK.test(key)) return;
    mkdirSync(dir, { recursive: true });

    writeJsonAtomic(join(dir, `${key}.polish.json`), JSON.stringify({ pass: partial.pass, fieldV: POLISH_PASSES[partial.pass]?.fieldV, sol: partial.sol }, f64Out));
  } catch {

  }
}

export function loadPolishPartial(dir: string, key: string): { pass: number; sol: MapSolution } | null {
  try {
    if (!KEY_OK.test(key)) return null;
    const file = join(dir, `${key}.polish.json`);
    if (!existsSync(file) || statSync(file).size > MAX_FILE_BYTES) return null;
    const raw = parseF64(readFileSync(file, "utf8"));
    if (typeof raw !== "object" || raw === null) return null;
    const o = raw as Record<string, unknown>;
    if (!isIdx(o.pass) || o.pass >= POLISH_PASSES.length || o.fieldV !== POLISH_PASSES[o.pass].fieldV) return null;
    const sol = solutionOf(o.sol);
    return sol !== null && sol.key === key ? { pass: o.pass, sol } : null;
  } catch {
    return null;
  }
}

export function dropPolishPartial(dir: string, key: string): void {
  try {
    if (!KEY_OK.test(key)) return;
    rmSync(join(dir, `${key}.polish.json`), { force: true });
  } catch {

  }
}

export function touchSolving(dir: string, key: string): void {
  try {
    if (!KEY_OK.test(key)) return;
    mkdirSync(dir, { recursive: true });

    const fd = openSync(join(dir, `${key}.solving`), constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
    try {
      writeSync(fd, String(Date.now()));
    } finally {
      closeSync(fd);
    }
  } catch {

  }
}

export function solvingAgeMs(dir: string, key: string): number | null {
  try {
    if (!KEY_OK.test(key)) return null;
    const file = join(dir, `${key}.solving`);
    return existsSync(file) ? Math.max(0, Date.now() - statSync(file).mtimeMs) : null;
  } catch {
    return null;
  }
}

export function dropSolving(dir: string, key: string): void {
  try {
    if (!KEY_OK.test(key)) return;
    rmSync(join(dir, `${key}.solving`), { force: true });
  } catch {

  }
}
