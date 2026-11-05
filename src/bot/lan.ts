import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { networkInterfaces } from "node:os";
import { EN, getLang, makeT } from "../i18n.ts";
import type { Lang } from "../i18n.ts";

export const LAN_COOKIE = "ddai_lan";

const SESSION_MS = 30 * 24 * 3600_000;
const MAX_SESSIONS = 50;

const IP_FAILS = 5;
const IP_WINDOW_MS = 60_000;
const IP_LOCK_MS = 60_000;

const ALL_FAILS = 20;
const ALL_WINDOW_MS = 600_000;
const ALL_LOCK_MS = 600_000;

const ROTATE_AFTER = 50;
const MAX_TRACKED_IPS = 1000;

export function isPrivateIPv4(addr: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr);
  if (m === null) return false;
  const p = m.slice(1).map(Number);
  if (p.some((n) => n > 255)) return false;
  return p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
}

export const VPN_NAME = /^(tun|tap|wg|utun|zt|ppp|tailscale)|wireguard|openvpn|vpn/i;

export function privateAddresses(ifaces: ReturnType<typeof networkInterfaces> = networkInterfaces()): string[] {
  const out: string[] = [];
  for (const [name, list] of Object.entries(ifaces)) {
    if (VPN_NAME.test(name)) continue;
    for (const a of list ?? []) {

      const v4 = (a.family as unknown) === 4 || (a.family as unknown) === "IPv4";
      if (v4 && !a.internal && isPrivateIPv4(a.address) && !out.includes(a.address)) out.push(a.address);
    }
  }
  return out;
}

export function lanWanted(v: unknown): boolean {
  if (v === true || v === 1) return true;
  return typeof v === "string" && ["on", "true", "yes", "1"].includes(v.trim().toLowerCase());
}

export function newLanCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function validLanCode(v: unknown): v is string {
  return typeof v === "string" && /^\d{6}$/.test(v);
}

export function lanHostOk(host: string | undefined, localAddress: string | undefined, port: number): boolean {
  if (typeof host !== "string" || typeof localAddress !== "string" || localAddress === "") return false;
  if (host === `${localAddress}:${port}`) return true;
  return port === 80 && host === localAddress;
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof header !== "string" || header.length > 4096) return out;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at <= 0) continue;
    const k = part.slice(0, at).trim();
    if (!out.has(k)) out.set(k, part.slice(at + 1).trim());
  }
  return out;
}

export type LanSession = { ip: string; created: number; lastSeen: number };

export type LoginResult =
  | { ok: true; token: string }
  | { ok: false; locked: boolean; retryAfter: number; rotated: boolean; globalLock: boolean };

export class LanGate {
  code: string;
  private sessions = new Map<string, { born: number; ip: string; last: number }>();
  private fails = new Map<string, number[]>();
  private locks = new Map<string, number>();
  private allFails: number[] = [];
  private allLockedUntil = 0;
  private totalFails = 0;
  private readonly now: () => number;
  private readonly onCode: (code: string) => void;

  constructor(opts: { code?: string; now?: () => number; onCode?: (code: string) => void } = {}) {
    this.now = opts.now ?? Date.now;
    this.onCode = opts.onCode ?? (() => {});
    if (validLanCode(opts.code)) this.code = opts.code;
    else {
      this.code = newLanCode();
      this.onCode(this.code);
    }
  }

  regenerate(revoke = true): string {
    let next = newLanCode();
    while (next === this.code) next = newLanCode();
    this.code = next;
    this.totalFails = 0;

    if (revoke) {
      this.fails.clear();
      this.locks.clear();
      this.allFails = [];
      this.allLockedUntil = 0;
      this.sessions.clear();
    }
    this.onCode(next);
    return next;
  }

  revokeAll(): void {
    this.sessions.clear();
  }

  sessionCount(): number {
    return this.sessions.size;
  }

  sessionList(): LanSession[] {
    const now = this.now();
    const out: LanSession[] = [];
    for (const [token, s] of this.sessions) {
      if (now - s.born > SESSION_MS) this.sessions.delete(token);
      else out.push({ ip: s.ip, created: s.born, lastSeen: s.last });
    }
    return out.sort((a, b) => b.lastSeen - a.lastSeen);
  }

  hasSession(cookieHeader: string | undefined): boolean {
    const token = parseCookies(cookieHeader).get(LAN_COOKIE);
    if (token === undefined || !/^[0-9a-f]{64}$/.test(token)) return false;
    const s = this.sessions.get(token);
    if (s === undefined) return false;
    const now = this.now();
    if (now - s.born > SESSION_MS) {
      this.sessions.delete(token);
      return false;
    }
    s.last = now;
    return true;
  }

  tryLogin(ip: string, submitted: string): LoginResult {
    const now = this.now();
    if (now < this.allLockedUntil) return { ok: false, locked: true, retryAfter: Math.ceil((this.allLockedUntil - now) / 1000), rotated: false, globalLock: false };
    const until = this.locks.get(ip);
    if (until !== undefined) {
      if (now < until) return { ok: false, locked: true, retryAfter: Math.ceil((until - now) / 1000), rotated: false, globalLock: false };
      this.locks.delete(ip);
    }
    const a = Buffer.from(this.code, "utf8");
    const b = Buffer.from(typeof submitted === "string" ? submitted.slice(0, 64) : "", "utf8");

    const right = b.length === a.length && timingSafeEqual(a, b);
    if (right) {
      this.fails.delete(ip);
      this.totalFails = 0;
      const token = randomBytes(32).toString("hex");
      this.sessions.set(token, { born: now, ip, last: now });
      while (this.sessions.size > MAX_SESSIONS) {
        const oldest = this.sessions.keys().next().value as string;
        this.sessions.delete(oldest);
      }
      return { ok: true, token };
    }

    if (this.fails.size >= MAX_TRACKED_IPS && !this.fails.has(ip)) {
      this.fails.clear();
      this.locks.clear();
    }
    const mine = (this.fails.get(ip) ?? []).filter((at) => now - at < IP_WINDOW_MS);
    mine.push(now);
    this.fails.set(ip, mine);
    let retryAfter = 0;
    if (mine.length >= IP_FAILS) {
      this.locks.set(ip, now + IP_LOCK_MS);
      this.fails.delete(ip);
      retryAfter = Math.ceil(IP_LOCK_MS / 1000);
    }
    this.allFails = this.allFails.filter((at) => now - at < ALL_WINDOW_MS);
    this.allFails.push(now);
    let globalLock = false;
    if (this.allFails.length >= ALL_FAILS) {
      globalLock = true;
      this.allLockedUntil = now + ALL_LOCK_MS;
      this.allFails = [];
      retryAfter = Math.ceil(ALL_LOCK_MS / 1000);
    }
    let rotated = false;
    if (++this.totalFails >= ROTATE_AFTER) {
      this.regenerate(false);
      rotated = true;
    }
    return { ok: false, locked: false, retryAfter, rotated, globalLock };
  }
}

export function sessionCookie(token: string): string {
  return `${LAN_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_MS / 1000)}`;
}

export const CMD_LIMIT = 5;
export const CMD_WINDOW_MS = 1000;
const CMD_MAX_KEYS = 200;

export class CmdLimiter {
  private seen = new Map<string, number[]>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  take(key: string): boolean {
    const now = this.now();
    if (this.seen.size > CMD_MAX_KEYS) {
      for (const [k, list] of this.seen) if (list.length === 0 || now - list[list.length - 1] >= CMD_WINDOW_MS) this.seen.delete(k);
    }
    const mine = (this.seen.get(key) ?? []).filter((at) => now - at < CMD_WINDOW_MS);
    if (mine.length >= CMD_LIMIT) {
      this.seen.set(key, mine);
      return false;
    }
    mine.push(now);
    this.seen.set(key, mine);
    return true;
  }
}

export function langOfHeader(accept: string | undefined): Lang {
  if (typeof accept === "string") {
    const first = accept.split(",")[0]?.trim().toLowerCase() ?? "";
    if (first.startsWith("ru")) return "ru";
    if (first.startsWith("en")) return "en";
  }
  return getLang();
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function loginPage(lang: Lang, state: "ask" | "wrong" | "locked", retryAfter = 0): string {
  const { t } = makeT(EN, lang);
  const note =
    state === "wrong" ? t("Код не подошёл") : state === "locked" ? t("Слишком много попыток. Подожди {s} с и попробуй снова", { s: retryAfter }) : "";
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>DDNet AI</title><style>
html,body{margin:0;min-height:100%;background:#12161c;color:#e8edf3;font:16px/1.4 system-ui,"Segoe UI",sans-serif}
main{max-width:340px;margin:0 auto;padding:12vh 20px 20px}
h1{font-size:22px;margin:0 0 6px}p{margin:0 0 18px;color:#9aa7b6}
input,button{box-sizing:border-box;width:100%;font:inherit;border-radius:10px;border:1px solid #33404f;padding:14px;margin-bottom:12px}
input{background:#1b222b;color:#fff;font-size:28px;letter-spacing:.3em;text-align:center}
button{background:#3b82f6;border-color:#3b82f6;color:#fff;font-weight:600;min-height:48px}
.err{color:#ff8a8a;margin-bottom:12px}
</style></head><body><main><h1>DDNet AI</h1><p>${esc(t("Введи код, который показан на компьютере: Настройки, С телефона"))}</p>${note === "" ? "" : `<div class="err" role="alert">${esc(note)}</div>`}<form method="post" action="/lan/login" autocomplete="off"><input name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" autofocus required aria-label="${esc(t("Код доступа"))}"><button type="submit">${esc(t("Войти"))}</button></form></main></body></html>`;
}
