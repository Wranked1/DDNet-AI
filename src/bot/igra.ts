export type PageView = "game" | "clips" | "settings";

export function viewOf(search: string): PageView {
  const m = /[?&]view=([a-z]+)(?:&|$)/.exec(String(search));
  return m !== null && (m[1] === "clips" || m[1] === "settings") ? m[1] : "game";
}

export function volumeGain(volume: number): number {
  const v = Number.isFinite(volume) ? Math.max(0, Math.min(100, volume)) / 100 : 1;
  return v * v;
}

export function soundGain(volume: number, dist: number | null, range: number): number {
  const base = volumeGain(volume);
  if (dist === null) return base;
  if (!(dist < range)) return 0;
  return (base * (range - Math.max(0, dist))) / range;
}

export function pluralIdx(n: number, lang: string): number {
  const k = Math.abs(Math.trunc(n));
  if (lang === "en") return k === 1 ? 0 : 2;
  const r10 = k % 10;
  const r100 = k % 100;
  if (r10 === 1 && r100 !== 11) return 0;
  if (r10 >= 2 && r10 <= 4 && (r100 < 12 || r100 > 14)) return 1;
  return 2;
}

export function clampBytes(text: string, n: number): string {
  let out = "";
  let used = 0;
  for (const ch of String(text)) {
    const c = ch.codePointAt(0) as number;
    const b = c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    if (used + b > n) break;
    out += ch;
    used += b;
  }
  return out;
}

export function identityReply(text: string): { state: "now" | "wait" | "saved" | "next" | "error"; seconds: number; text: string } {
  const s = String(text).trim().replace(/^.*?: (?=identity: )/, "");
  const wait = /^identity: in (\d+) s$/.exec(s);
  if (wait !== null) return { state: "wait", seconds: Number(wait[1]), text: s };
  if (/^identity: now$/.test(s)) return { state: "now", seconds: 0, text: s };
  if (/^identity: saved for the next start/.test(s)) return { state: "next", seconds: 0, text: s };
  if (/^identity: saved/.test(s)) return { state: "saved", seconds: 0, text: s };
  return { state: "error", seconds: 0, text: s };
}

export function botLine(who: "a" | "b", cmd: string): string {
  return who === "b" ? "!d " + cmd.replace(/^!/, "") : cmd;
}

export function styleOf(panel: { wbMode?: string | null; inDuel?: boolean } | null | undefined): "default" | "wb" | "duel" {
  if (panel && panel.inDuel === true) return "duel";
  const wb = panel ? panel.wbMode : null;
  return wb !== null && wb !== undefined && wb !== "off" ? "wb" : "default";
}

export function modeOf(st: { acting?: boolean; mode?: string } | null | undefined): "fight" | "passive" | "hold" {
  if (!st || st.acting === false) return "hold";
  return st.mode === "passive" ? "passive" : st.mode === "hold" ? "hold" : "fight";
}

type BotView = {
  who: "a" | "b";
  online: boolean;
  running: boolean;
  name: string;
  id: number;
  phase: string;
  frozen: boolean;
  acting: boolean;
  mode: string;
  wb: string | null;
  target: string | null;
  panel: { wbMode?: string | null; inDuel?: boolean; home?: boolean; pinnedTarget?: string | null; duelScore?: { name: string; ours: number; theirs: number } | null } | null;
  blocks: number | null;
  blockedBy: number | null;
  kills: number | null;
  deaths: number | null;
  hooks: number | null;
};

export function statNum(stats: string, key: string): number | null {
  const m = new RegExp("(?:^|\\s)" + key + "=(\\d+)").exec(String(stats));
  return m === null ? null : Number(m[1]);
}

export function botsOf(status: any, stats: string, selfId: number): BotView[] {
  const s = status || {};
  const a: BotView = {
    who: "a",
    online: s.phase === "online",
    running: true,
    name: String(s.name || ""),
    id: Number.isFinite(selfId) ? selfId : -1,
    phase: String(s.phase || "offline"),
    frozen: s.frozen === true,
    acting: s.acting !== false,
    mode: String(s.mode || "fight"),
    wb: typeof s.wb === "string" ? s.wb : null,
    target: typeof s.targetName === "string" ? s.targetName : null,
    panel: s.panel || null,
    blocks: statNum(stats, "blocks"),
    blockedBy: statNum(stats, "blockedBy"),
    kills: statNum(stats, "kills"),
    deaths: statNum(stats, "deaths"),
    hooks: statNum(stats, "hooksFired"),
  };
  const d = s.dummy;
  const b: BotView =
    d && typeof d === "object"
      ? {
          who: "b",
          online: d.phase === "online",
          running: true,
          name: String(d.name || ""),
          id: Number.isFinite(d.id) ? d.id : -1,
          phase: String(d.phase || "offline"),
          frozen: d.frozen === true,
          acting: d.acting !== false,
          mode: String(d.mode || "fight"),
          wb: typeof d.wb === "string" ? d.wb : null,
          target: typeof d.target === "string" ? d.target : null,
          panel: d.panel || null,
          blocks: Number.isFinite(d.blocks) ? d.blocks : null,
          blockedBy: Number.isFinite(d.blockedBy) ? d.blockedBy : null,
          kills: Number.isFinite(d.kills) ? d.kills : null,
          deaths: Number.isFinite(d.deaths) ? d.deaths : null,
          hooks: Number.isFinite(d.hooks) ? d.hooks : null,
        }
      : { who: "b", online: false, running: false, name: "", id: -1, phase: "offline", frozen: false, acting: false, mode: "hold", wb: null, target: null, panel: null, blocks: null, blockedBy: null, kills: null, deaths: null, hooks: null };
  return [a, b];
}

export function botState(b: BotView): { key: string; tone: "free" | "hold" | "ice" | "off" } {
  if (!b.running) return { key: "off", tone: "off" };
  if (!b.online) return { key: "away", tone: "off" };
  if (b.frozen) return { key: "frozen", tone: "ice" };
  if (b.panel && b.panel.inDuel === true) return { key: "duel", tone: "free" };
  if (b.acting === false || b.mode === "hold") return { key: "hold", tone: "off" };
  if (b.wb === "WB left") return { key: "wb-left", tone: "hold" };
  if (b.wb === "WB right") return { key: "wb-right", tone: "hold" };
  if (b.mode === "goto") return { key: "goto", tone: "free" };
  if (b.mode === "passive") return { key: "passive", tone: "free" };
  return b.target !== null ? { key: "target", tone: "free" } : { key: "seek", tone: "free" };
}

type Mate = { id: number; name?: string; clan?: string; x?: number; y?: number; cc?: boolean; cb?: number };
type Near = { id: number; name: string; clan: string; blocks: number; cc: boolean; cb: number };

export function nearby(tees: Mate[], me: { x: number; y: number } | null, skip: number[], n: number): { list: Near[]; total: number } {
  const rows: Near[] = [];
  for (const t of tees || []) {
    if (!t || typeof t.name !== "string" || t.name === "" || skip.indexOf(t.id) >= 0) continue;
    const blocks = me && Number.isFinite(t.x) && Number.isFinite(t.y) ? Math.round(Math.hypot((t.x as number) - me.x, (t.y as number) - me.y) / 32) : -1;
    rows.push({ id: t.id, name: t.name, clan: typeof t.clan === "string" ? t.clan : "", blocks, cc: t.cc === true, cb: typeof t.cb === "number" ? t.cb : 0 });
  }
  rows.sort((p, q) => (p.blocks < 0 ? 1e9 : p.blocks) - (q.blocks < 0 ? 1e9 : q.blocks) || p.name.localeCompare(q.name));
  return { list: rows.slice(0, Math.max(0, n)), total: rows.length };
}

type DdItem = { value: string; label: string; sub?: string; gone?: boolean };

export function targetItems(players: Mate[], skip: number[], picked: string | null): DdItem[] {
  const rows: DdItem[] = [];
  for (const p of players || []) {
    if (!p || typeof p.name !== "string" || p.name === "" || skip.indexOf(p.id) >= 0) continue;
    rows.push({ value: p.name, label: p.name, sub: typeof p.clan === "string" ? p.clan : "" });
  }
  rows.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()) || a.label.localeCompare(b.label));
  if (picked !== null && picked !== "" && !rows.some((r) => r.value === picked)) rows.unshift({ value: picked, label: picked, sub: "", gone: true });
  return rows;
}

export function ddFilter(items: DdItem[], q: string): DdItem[] {
  const w = String(q).trim().toLowerCase();
  if (w === "") return items;
  return items.filter((i) => (i.label + " " + (i.sub || "")).toLowerCase().includes(w));
}

export function ddFilterable(n: number): boolean {
  return n > 8;
}

export function ddKey(key: string, at: number, n: number): number {
  if (n <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  if (key === "PageDown") return Math.min(n - 1, Math.max(0, at) + 7);
  if (key === "PageUp") return Math.max(0, Math.max(0, at) - 7);
  if (key === "ArrowDown") return at < 0 ? 0 : (at + 1) % n;
  if (key === "ArrowUp") return at <= 0 ? n - 1 : at - 1;
  return -1;
}

export function ddPlace(
  rect: { left: number; right: number; top: number; bottom: number },
  vw: number,
  vh: number,
  want: { w: number; h: number },
): { left: number; top: number; width: number; maxH: number; up: boolean } {
  const gap = 4;
  const edge = 8;
  const below = vh - rect.bottom - gap - edge;
  const above = rect.top - gap - edge;
  const up = below < want.h && above > below;
  const room = Math.max(60, up ? above : below);
  const maxH = Math.min(want.h, room);
  const width = Math.min(Math.max(rect.right - rect.left, want.w), Math.max(120, vw - edge * 2));
  const left = Math.max(edge, Math.min(rect.left, vw - width - edge));
  const top = up ? Math.max(edge, rect.top - gap - maxH) : rect.bottom + gap;
  return { left, top, width, maxH, up };
}

export function ddKeep(items: DdItem[], value: string | null, was: number): number {
  if (items.length === 0) return -1;
  if (value !== null) {
    const at = items.findIndex((i) => i.value === value);
    if (at >= 0) return at;
  }
  return Math.max(0, Math.min(items.length - 1, was));
}

export function copyLines(first: BotView): string[] {
  const out: string[] = [];
  const style = styleOf(first.panel);
  out.push("!style " + style);
  const wb = first.panel ? first.panel.wbMode : null;
  if (style === "wb" && (wb === "left" || wb === "right" || wb === "auto")) out.push("!wb " + wb);
  out.push("!mode " + modeOf(first));
  const pin = first.panel ? first.panel.pinnedTarget : null;
  out.push(typeof pin === "string" && pin !== "" ? "!target " + pin : "!target -");
  return out.map((l) => botLine("b", l));
}

export function switchLine(key: string, on: boolean): string | null {
  const map: Record<string, [string, string]> = {
    pathfind: ["!pathfind on", "!pathfind off"],
    preinput: ["!preinput on", "!preinput off"],
    humanlike: ["!humanlike on", "!humanlike off"],
    lowCpu: ["!low on", "!low off"],
    strong: ["!strong on", "!strong off"],
  };
  const pair = map[key];
  return pair === undefined ? null : on ? pair[0] : pair[1];
}

export function switchOn(key: string, launch: Record<string, unknown> | null, status: Record<string, unknown> | null): boolean {
  const l = launch || {};
  const s = status || {};
  if (key === "lowCpu") return s.lowCpu === true;
  if (key === "strong") return s.strong === true;
  if (key === "dummy") return l.dummy === "on";
  if (key === "pathfind") return l.pathfind !== "off";
  if (key === "preinput") return !(l.preinput === "off" || l.preinput === false);
  const h = l.humanlike;
  return !(h === false || (typeof h === "string" && ["off", "false", "no", "0"].indexOf(h.trim().toLowerCase()) >= 0));
}

export function moreKey(key: string, at: number, n: number): number {
  if (n <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  if (key === "ArrowDown" || key === "ArrowRight") return at < 0 ? 0 : (at + 1) % n;
  if (key === "ArrowUp" || key === "ArrowLeft") return at <= 0 ? n - 1 : at - 1;
  return -1;
}

export function zoomStep(zoom: number, dir: number): number {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const next = dir > 0 ? z / 1.25 : z * 1.25;
  return Math.max(1 / 3, Math.min(100 / 3, next));
}
export function zoomPercent(zoom: number): number {
  return Number.isFinite(zoom) && zoom > 0 ? Math.round(100 / zoom) : 100;
}

export function statsOf(b: BotView | null | undefined): { key: "kills" | "deaths" | "hooks"; value: string }[] {
  const v = (n: number | null | undefined): string => (typeof n === "number" && Number.isFinite(n) ? String(n) : "\u2014");
  return [
    { key: "kills", value: v(b ? b.kills : null) },
    { key: "deaths", value: v(b ? b.deaths : null) },
    { key: "hooks", value: v(b ? b.hooks : null) },
  ];
}

export function emoteLine(who: "a" | "b", name: string): string | null {
  const known = ["hearts", "exclamation", "question", "sorry", "drop", "splat", "zzz"];
  return known.indexOf(name) >= 0 ? botLine(who, "!emote " + name) : null;
}

export function specValue(cur: string, ids: number[], embedded: boolean): string {
  const v = String(cur);
  if (embedded && (v === "map" || v === "free")) return v;
  return ids.some((id) => String(id) === v) ? v : "-1";
}

export function identitySave(who: "a" | "b", field: string, value: string): Record<string, string> | null {
  if (who !== "b") return null;
  const key = field === "nick" ? "dummyName" : field === "clan" ? "dummyClan" : field === "skin" ? "dummySkin" : null;
  return key === null ? null : { [key]: String(value).trim() };
}

export function lagHint(status: { phase?: string; lag?: { hint?: boolean; workMs?: number; skipped?: number } | null; strong?: boolean; lowCpu?: boolean } | null | undefined): { kind: "strong" | "low" | "plain"; ms: number; n: number } | null {
  const s = status || {};
  const lag = s.lag;
  if (s.phase !== "online" || !lag || lag.hint !== true) return null;
  const ms = Number.isFinite(lag.workMs) ? Math.round(lag.workMs as number) : 0;
  const n = Number.isFinite(lag.skipped) ? (lag.skipped as number) : 0;
  return { kind: s.strong === true ? "strong" : s.lowCpu === true ? "low" : "plain", ms, n };
}

export function dummyNick(name: string, given: string): string {
  const first = String(name || "");
  const nick = clampBytes(String(given || "").trim() || clampBytes(first, 14) + "2", 15);
  return nick === first ? clampBytes(first, 14) + (first.endsWith("2") ? "3" : "2") : nick;
}
