import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { writeJsonAtomic } from "./atomicWrite.ts";

export const ANNOUNCE_EVERY_TICKS = 9000;

export const ANNOUNCE_FIRST_TICKS = 3000;
export const ANNOUNCE_TEXT = "Hi, I'm a bot (ddnet-ai). Free download: t.me/aiddnet or github.com/Wranked1/DDNet-AI";

export const ANNOUNCE_RETRY_TICKS = 50;

export const ANNOUNCE_STOP_WINDOW_TICKS = 3000;

export const ANNOUNCE_NAMES_MAX = 5000;

export const ANNOUNCE_NAME_MAX = 16;

export const ANNOUNCE_STOP_MARK = "\u0001";
export const ANNOUNCE_FILE_NAME = "announced.json";

export type AnnounceStore = { load(): string[]; save(names: string[]): void };
export type AnnouncePlayer = { id: number; name: string; clan?: string };
export type AnnounceOptions = { ownName?: string; dummyName?: string; store?: AnnounceStore };

const BOTLIKE = ["ddnet-ai", "ai-tee", "bot"];
const CONTROL = /[\u0000-\u001f\u007f]/;

function quoted(name: string): string {
  return `"${name.replace(/["\\]/g, "\\$&")}"`;
}

function capped(set: Set<string>, max: number): void {
  while (set.size > max) {
    const oldest = set.values().next();
    if (oldest.done === true) return;
    set.delete(oldest.value);
  }
}

export class Announcer {
  private readonly told = new Set<string>();
  private readonly stopped = new Set<string>();
  private readonly ownName: string;
  private readonly dummyName: string;
  private readonly store: AnnounceStore | undefined;

  private nextAt: number | null = null;
  private checkAt = -Infinity;
  private lastTick = -Infinity;
  private last: { name: string; tick: number } | null = null;

  constructor(opts: AnnounceOptions = {}) {
    this.ownName = (opts.ownName ?? "").trim().toLowerCase();
    this.dummyName = (opts.dummyName ?? "").trim().toLowerCase();
    this.store = opts.store;
    let saved: string[] = [];
    try {
      const got = this.store?.load();
      if (Array.isArray(got)) saved = got;
    } catch {

    }
    for (const entry of saved) {
      if (typeof entry !== "string") continue;
      if (entry.startsWith(ANNOUNCE_STOP_MARK)) this.stopped.add(entry.slice(ANNOUNCE_STOP_MARK.length));
      else this.told.add(entry);
    }
    capped(this.told, ANNOUNCE_NAMES_MAX);
    capped(this.stopped, ANNOUNCE_NAMES_MAX);
  }

  next(tick: number, ownId: number, players: readonly AnnouncePlayer[], rnd: () => number): { name: string; text: string } | null {

    if (this.nextAt === null || tick < this.lastTick) this.joined(tick);
    this.lastTick = tick;
    if (this.nextAt === null || tick < this.nextAt || tick < this.checkAt) return null;
    this.checkAt = tick + ANNOUNCE_RETRY_TICKS;
    const pool = players.filter((p) => this.allowed(p, ownId));
    if (pool.length === 0) return null;
    const pick = pool[Math.min(pool.length - 1, Math.max(0, Math.floor(rnd() * pool.length)))];
    const name = pick.name.trim();
    this.told.add(name);
    capped(this.told, ANNOUNCE_NAMES_MAX);
    this.persist();
    this.nextAt = tick + ANNOUNCE_EVERY_TICKS;
    this.last = { name, tick };
    return { name, text: `/w ${quoted(name)} ${ANNOUNCE_TEXT}` };
  }

  heard(fromName: string, text: string, whisper: boolean, tick: number): void {
    const from = fromName.trim();
    if (from === "") return;
    const said = text.trim().toLowerCase();
    const plain = whisper && said === "stop";
    const after = this.last !== null && this.last.name === from && tick >= this.last.tick && tick - this.last.tick <= ANNOUNCE_STOP_WINDOW_TICKS && said.includes("stop");
    if (!plain && !after) return;
    if (this.stopped.has(from)) return;
    this.stopped.add(from);
    capped(this.stopped, ANNOUNCE_NAMES_MAX);
    this.persist();
  }

  joined(tick: number): void {
    this.nextAt = tick + ANNOUNCE_FIRST_TICKS;
    this.checkAt = -Infinity;
    this.lastTick = tick;
    this.last = null;
  }

  private allowed(p: AnnouncePlayer, ownId: number): boolean {
    if (p.id === ownId) return false;
    const name = typeof p.name === "string" ? p.name.trim() : "";
    if (name === "" || [...name].length > ANNOUNCE_NAME_MAX || CONTROL.test(name)) return false;
    const low = name.toLowerCase();
    if (low === this.ownName || low === this.dummyName) return false;
    const clan = typeof p.clan === "string" ? p.clan.toLowerCase() : "";
    if (BOTLIKE.some((w) => low.includes(w) || clan.includes(w))) return false;
    return !this.told.has(name) && !this.stopped.has(name);
  }

  private persist(): void {
    if (this.store === undefined) return;
    try {
      this.store.save([...this.told, ...[...this.stopped].map((n) => ANNOUNCE_STOP_MARK + n)]);
    } catch {

    }
  }
}

export function announceFileStore(file: string): AnnounceStore {
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    load(): string[] {
      try {
        const raw = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as { told?: unknown; stopped?: unknown } | null;
        if (raw === null || typeof raw !== "object") return [];
        return [...strings(raw.told).slice(-ANNOUNCE_NAMES_MAX), ...strings(raw.stopped).slice(-ANNOUNCE_NAMES_MAX).map((n) => ANNOUNCE_STOP_MARK + n)];
      } catch {
        return [];
      }
    },
    save(names: string[]): void {
      try {

        const ours = new Set(names);
        const all = [...this.load().filter((n) => !ours.has(n)), ...names];
        const stopped = all.filter((n) => n.startsWith(ANNOUNCE_STOP_MARK)).map((n) => n.slice(ANNOUNCE_STOP_MARK.length));
        const told = all.filter((n) => !n.startsWith(ANNOUNCE_STOP_MARK));
        mkdirSync(dirname(file), { recursive: true });
        writeJsonAtomic(file, JSON.stringify({ told: told.slice(-ANNOUNCE_NAMES_MAX), stopped: stopped.slice(-ANNOUNCE_NAMES_MAX) }));
      } catch {

      }
    }
  };
}
