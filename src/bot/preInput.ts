import { createRequire } from "node:module";
import type { PlayerInput, TeeState } from "../core/types.ts";
import { readVarInt } from "./inputTiming.ts";

export const PREINPUT_NAME = "preinput@netmsg.ddnet.org";

const KEEP = 64;

const MAX_OWNER = 127;

export const MAX_AHEAD = 24;

const HOOK_IDLE = 0;

export type PreInputMsg = {
  owner: number;
  tick: number;
  direction: number;
  targetX: number;
  targetY: number;
  jump: number;
  fire: number;
  hook: number;
  wantedWeapon: number;
  nextWeapon: number;
  prevWeapon: number;

  then?: PreInputMsg;
};

let nameHash: Buffer | null = null;

export function decodePreInput(chunk: { sys?: boolean; msgid?: number; raw?: Uint8Array }): PreInputMsg | null {
  const raw = chunk.raw;
  if (chunk.sys !== false || chunk.msgid !== 0 || raw === undefined || raw.length < 16 + 11) return null;
  if (nameHash === null) {

    try {
      nameHash = (createRequire(import.meta.url)("teeworlds/lib/UUIDManager.js") as { createTwMD5Hash: (name: string) => Buffer }).createTwMD5Hash(PREINPUT_NAME);
    } catch {
      return null;
    }
  }
  for (let i = 0; i < 16; i++) if (raw[i] !== nameHash[i]) return null;
  const v: number[] = [];
  let at = 16;
  for (let i = 0; i < 11; i++) {
    const r = readVarInt(raw, at);
    if (r === null) return null;
    v.push(r.value);
    at = r.next;
  }
  const [direction, targetX, targetY, jump, fire, hook, wantedWeapon, nextWeapon, prevWeapon, owner, tick] = v;
  if (owner < 0 || owner > MAX_OWNER || tick < 0 || direction < -1 || direction > 1) return null;
  return { owner, tick, direction, targetX, targetY, jump, fire, hook, wantedWeapon, nextWeapon, prevWeapon };
}

let patched = false;

export function patchPreInputDecode(): boolean {
  if (patched) return true;
  try {
    const require = createRequire(import.meta.url);
    const mod = require("teeworlds/lib/client.js") as { Client?: { prototype: Record<string, unknown> } };
    const proto = mod.Client?.prototype;
    const unpack = proto?.Unpack;
    if (proto === undefined || typeof unpack !== "function") return false;
    proto.Unpack = function withPreInput(this: { emit?: (e: string, ...a: unknown[]) => boolean; listenerCount?: (e: string) => number }, packet: Buffer) {
      const out = (unpack as (p: Buffer) => { chunks?: unknown }).call(this, packet);

      try {

        if (typeof this.listenerCount === "function" && this.listenerCount("pre_input") === 0) return out;
        const chunks = out?.chunks;
        if (!Array.isArray(chunks)) return out;
        for (const c of chunks as unknown[]) {
          if (c === null || typeof c !== "object") continue;
          const ch = c as { sys?: boolean; msgid?: number; raw?: Uint8Array };
          if (ch.sys !== false || ch.msgid !== 0 || !(ch.raw instanceof Uint8Array)) continue;
          let m: PreInputMsg | null = null;
          try {
            m = decodePreInput(ch);
          } catch {
            m = null;
          }
          if (m === null) continue;

          try {
            this.emit?.("pre_input", m);
          } catch {

          }
        }
      } catch {

      }
      return out;
    };
    patched = true;
    return true;
  } catch {
    return false;
  }
}

export type PreInputStats = {
  received: number;
  stored: number;

  behind: number;
  ahead: number;
  duplicate: number;
  stale: number;

  pairsAhead: number;
  pairsNone: number;

  knownAhead: number[];

  lead: number[];
  checked: number;
  distrusted: number;

  plans: number;
  planTicks: number;

  decisions: number;
  decisionsReal: number;

  scored: number;
  errPre: number;
  errModel: number;
  nearer: number;
  farther: number;
};

const BINS = 8;

function blankStats(): PreInputStats {
  return {
    received: 0, stored: 0, behind: 0, ahead: 0, duplicate: 0, stale: 0, pairsAhead: 0, pairsNone: 0,
    knownAhead: new Array<number>(BINS).fill(0), lead: new Array<number>(BINS + 4).fill(0),
    checked: 0, distrusted: 0, plans: 0, planTicks: 0, decisions: 0, decisionsReal: 0,
    scored: 0, errPre: 0, errModel: 0, nearer: 0, farther: 0,
  };
}

export type PreInputPlan = {

  held: PlayerInput;

  ahead: PlayerInput[];
};

export type Trust = "ok" | "bad" | "none";

type Pending = { id: number; tick: number; pre: { x: number; y: number }; model: { x: number; y: number } };

export class PreInputStore {
  private owners = new Map<number, PreInputMsg[]>();
  private pending: Pending[] = [];
  stats: PreInputStats = blankStats();

  clear(): void {
    this.owners.clear();
    this.pending.length = 0;
  }

  expect(id: number, tick: number, pre: { x: number; y: number }, model: { x: number; y: number }): void {
    this.pending.push({ id, tick, pre: { x: pre.x, y: pre.y }, model: { x: model.x, y: model.y } });
    if (this.pending.length > 16) this.pending.shift();
  }

  settle(snapTick: number, tees: readonly TeeState[]): void {
    if (this.pending.length === 0) return;
    const s = this.stats;
    const keep: Pending[] = [];
    for (const p of this.pending) {
      if (p.tick > snapTick) {
        keep.push(p);
        continue;
      }
      if (p.tick < snapTick) continue;
      const t = tees.find((x) => x.id === p.id);
      if (t === undefined || !t.alive) continue;
      const ePre = Math.hypot(t.pos.x - p.pre.x, t.pos.y - p.pre.y);
      const eModel = Math.hypot(t.pos.x - p.model.x, t.pos.y - p.model.y);
      s.scored++;
      s.errPre += ePre;
      s.errModel += eModel;
      if (ePre < eModel - 0.01) s.nearer++;
      else if (ePre > eModel + 0.01) s.farther++;
    }
    this.pending = keep;
  }

  forget(owner: number): void {
    this.owners.delete(owner);
  }

  record(m: PreInputMsg, snapTick: number | undefined): void {
    const s = this.stats;
    s.received++;
    if (snapTick !== undefined) {
      const lead = m.tick - snapTick;
      s.behind += lead <= 0 ? 1 : 0;
      s.ahead += lead > 0 ? 1 : 0;
      s.lead[Math.max(0, Math.min(s.lead.length - 1, lead + 2))]++;
    }
    let list = this.owners.get(m.owner);
    if (list === undefined) this.owners.set(m.owner, (list = []));

    let i = list.length;
    while (i > 0 && list[i - 1].tick > m.tick) i--;
    if (i > 0 && list[i - 1].tick === m.tick) {

      s.duplicate++;
      list[i - 1].then = m;
      return;
    }
    if (i === 0 && list.length >= KEEP) {
      s.stale++;
      return;
    }
    list.splice(i, 0, m);
    if (list.length > KEEP) list.shift();
    s.stored++;
  }

  newest(owner: number): number | null {
    const list = this.owners.get(owner);
    return list === undefined || list.length === 0 ? null : list[list.length - 1].tick;
  }

  at(owner: number, tick: number): PreInputMsg | null {
    const list = this.owners.get(owner);
    if (list === undefined) return null;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m.tick <= tick) return m.tick < tick && m.then !== undefined ? m.then : m;
    }
    return null;
  }

  trust(owner: number, snapTick: number, tee: TeeState): Trust {
    const m = this.at(owner, snapTick);
    if (m === null) return "none";
    if (!tee.alive || tee.frozen) return "none";
    if (m.direction !== tee.direction) return "bad";
    if ((m.hook !== 0) !== (tee.hookState !== HOOK_IDLE)) return "bad";
    const jumpedKey = (tee.jumped & 1) !== 0;
    if (m.jump === 0 && jumpedKey) return "bad";

    if (m.jump !== 0 && !jumpedKey && (tee.jumped & 2) === 0 && tee.jumps !== 0 && tee.jumpsLeft > 0) return "bad";
    return "ok";
  }

  noteSnapshot(snapTick: number, ownId: number, tees: readonly TeeState[], inGame?: ReadonlySet<number>): void {
    const s = this.stats;
    for (const t of tees) {
      if (t.id === ownId || !t.alive) continue;
      const newest = this.newest(t.id);
      if (newest === null) {
        s.pairsNone++;
        continue;
      }
      const ahead = Math.max(0, newest - snapTick);
      if (ahead > 0) s.pairsAhead++;
      s.knownAhead[Math.min(BINS - 1, ahead)]++;
    }

    if (inGame !== undefined && inGame.size > 0 && this.owners.size > 0) {
      for (const id of [...this.owners.keys()]) if (!inGame.has(id)) this.owners.delete(id);
    }
  }

  plan(tee: TeeState, snapTick: number, model: PlayerInput): PreInputPlan | null {
    const newest = this.newest(tee.id);
    if (newest === null || newest <= snapTick) return null;
    const verdict = this.trust(tee.id, snapTick, tee);
    if (verdict === "none") return null;
    this.stats.checked++;
    if (verdict === "bad") {
      this.stats.distrusted++;
      return null;
    }
    const last = Math.min(newest, snapTick + MAX_AHEAD);
    const ahead: PlayerInput[] = [];
    for (let t = snapTick + 1; t <= last; t++) ahead.push(this.input(tee.id, t, model));
    this.stats.plans++;
    this.stats.planTicks += ahead.length;
    return { held: this.input(tee.id, snapTick, model), ahead };
  }

  private input(owner: number, t: number, model: PlayerInput): PlayerInput {
    const m = this.at(owner, t);
    const out: PlayerInput = { ...model };
    if (m === null) return out;
    out.direction = m.direction;
    out.hook = m.hook !== 0 ? 1 : 0;
    out.jump = m.jump !== 0 ? 1 : 0;

    if (m.tick === t && (m.targetX !== 0 || m.targetY !== 0)) {
      out.targetX = m.targetX;
      out.targetY = m.targetY;
    }
    return out;
  }

  line(on: boolean): string {
    const s = this.stats;
    const share = (n: number, of: number): string => (of === 0 ? "-" : `${((100 * n) / of).toFixed(0)}%`);
    const pairs = s.pairsNone + s.knownAhead.reduce((a, b) => a + b, 0);
    return (
      `pre-inputs (${on ? "on" : "off"}): received ${s.received}, stored ${s.stored}, duplicate ${s.duplicate}, stale ${s.stale}, ahead of the snapshot ${s.ahead}/${s.received}, ` +
      `known_ahead>=1 on ${s.pairsAhead}/${pairs} pairs [${s.knownAhead.join(" ")}], none ${s.pairsNone}, ` +
      `checked ${s.checked} distrusted ${s.distrusted} (${share(s.distrusted, s.checked)}), ` +
      `decisions ${s.decisionsReal}/${s.decisions} with a plan, ${s.planTicks} ticks, ` +
      (s.scored === 0
        ? "no position scored"
        : `his position lag ticks on, mean error ${(s.errPre / s.scored).toFixed(1)}px with the messages vs ${(s.errModel / s.scored).toFixed(1)}px without (${s.scored} scored: nearer ${s.nearer}, farther ${s.farther})`)
    );
  }
}
