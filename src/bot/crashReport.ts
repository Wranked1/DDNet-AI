import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isNetworkDecodeError } from "./netPatch.ts";

export const CRASH_TAIL_LINES = 200;

const MAX_LINE = 2000;

const tail: string[] = [];

export function noteCrashLine(line: string): void {
  tail.push(line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}...` : line);
  if (tail.length > CRASH_TAIL_LINES) tail.shift();
}

export function crashLines(): readonly string[] {
  return tail;
}

export function crashText(err: unknown, origin: string, now: Date = new Date()): string {
  const what = err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : String(err);
  return [`time: ${now.toISOString()}`, `origin: ${origin}`, `node: ${process.version} ${process.platform}`, "", what, "", `--- last ${tail.length} log lines ---`, ...tail, ""].join("\n");
}

export function writeCrashReport(file: string, err: unknown, origin: string): boolean {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, crashText(err, origin));
    return true;
  } catch {
    return false;
  }
}

export function installCrashReport(file: string): void {
  process.on("uncaughtExceptionMonitor", (err, origin) => {
    if (process.listenerCount("uncaughtException") > 0 && isNetworkDecodeError(err)) return;
    writeCrashReport(file, err, origin);
  });
}
