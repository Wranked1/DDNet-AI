import { EventEmitter } from "node:events";
import { createSocket } from "node:dgram";
import type { RemoteInfo, Socket as UdpSocket } from "node:dgram";
import { lookup } from "node:dns/promises";
import { BlockList, connect, isIPv4, isIPv6 } from "node:net";
import type { Socket as TcpSocket } from "node:net";
import { t } from "../i18n.ts";

function canon(a: string): string {
  if (!isIPv6(a)) return a;

  try {
    return new URL(`http://[${a}]/`).hostname.slice(1, -1);
  } catch {
    return a;
  }
}

const PRIVATE = new BlockList();
for (const [net, bits] of [["10.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16]] as const) PRIVATE.addSubnet(net, bits, "ipv4");
PRIVATE.addSubnet("fc00::", 7, "ipv6");
PRIVATE.addSubnet("fe80::", 10, "ipv6");
PRIVATE.addAddress("::1", "ipv6");
const isPrivate = (a: string): boolean => (isIPv4(a) ? PRIVATE.check(a, "ipv4") : isIPv6(a) ? PRIVATE.check(a, "ipv6") : false);

export type ProxyCfg = { host: string; port: number; user?: string; pass?: string };
export type ParsedProxy = { ok: true; proxy: ProxyCfg } | { ok: false; error: string };

const HANDSHAKE_MS = 8000;
const RETRY_MS = 3000;
const QUEUE_MAX = 64;
const MAX_CRED_BYTES = 255;

export function proxyLabel(p: ProxyCfg): string {
  return `${p.host.includes(":") ? `[${p.host}]` : p.host}:${p.port}`;
}

function bad(error: string): ParsedProxy {
  return { ok: false, error };
}

function finish(host: string, portText: string, user: string | undefined, pass: string | undefined): ParsedProxy {
  if (!/^\d{1,5}$/.test(portText)) return bad(t("В адресе прокси нужен порт от 1 до 65535"));
  const port = Number(portText);
  if (port < 1 || port > 65535) return bad(t("В адресе прокси нужен порт от 1 до 65535"));
  if (host === "" || !(isIPv6(host) || /^[A-Za-z0-9._-]+$/.test(host))) return bad(t("Не разобрать адрес прокси: нужен вид socks5://логин:пароль@хост:порт или хост:порт"));
  if (user !== undefined) {
    if (user === "") return bad(t("Не разобрать адрес прокси: нужен вид socks5://логин:пароль@хост:порт или хост:порт"));

    if (Buffer.byteLength(user) > MAX_CRED_BYTES || Buffer.byteLength(pass ?? "") > MAX_CRED_BYTES) return bad(t("Логин и пароль прокси не длиннее 255 байт"));
  }
  const proxy: ProxyCfg = { host, port };
  if (user !== undefined) {
    proxy.user = user;
    proxy.pass = pass ?? "";
  }
  return { ok: true, proxy };
}

function fromUrl(rest: string): ParsedProxy {
  const shape = t("Не разобрать адрес прокси: нужен вид socks5://логин:пароль@хост:порт или хост:порт");
  const body = rest.replace(/\/+$/, "");
  if (body === "" || body.includes("/") || /\s/.test(body)) return bad(shape);
  const at = body.lastIndexOf("@");
  const info = at >= 0 ? body.slice(0, at) : null;
  const hostPort = body.slice(at + 1);
  let user: string | undefined;
  let pass: string | undefined;
  if (info !== null) {
    const c = info.indexOf(":");
    try {
      user = decodeURIComponent(c < 0 ? info : info.slice(0, c));
      pass = c < 0 ? undefined : decodeURIComponent(info.slice(c + 1));
    } catch {
      return bad(shape);
    }
  }
  const m = /^\[([^\]]+)\]:(\d*)$/.exec(hostPort) ?? /^([^:[\]]+):(\d*)$/.exec(hostPort);
  if (m === null) return bad(/^[^:]+$/.test(hostPort) ? t("В адресе прокси нужен порт от 1 до 65535") : shape);
  return finish(m[1], m[2], user, pass);
}

export function parseProxy(text: string): ParsedProxy {
  const s = text.trim();
  if (s === "") return bad(t("Адрес прокси пустой"));
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(s);
  if (scheme !== null) {
    const name = scheme[1].toLowerCase();
    if (name === "socks5" || name === "socks5h") return fromUrl(s.slice(scheme[0].length));
    return bad(t("Нужен SOCKS5-прокси: бот играет по UDP, HTTP-прокси его не пропускают"));
  }
  const parts = s.split(":");
  if (parts.length === 2) return finish(parts[0], parts[1], undefined, undefined);
  if (parts.length >= 4) return finish(parts[0], parts[1], parts[2], parts.slice(3).join(":"));
  return bad(t("Не разобрать адрес прокси: нужен вид socks5://логин:пароль@хост:порт или хост:порт"));
}

class Reader {
  private buf: Buffer = Buffer.alloc(0);
  private want = 0;
  private res: ((b: Buffer) => void) | null = null;
  private rej: ((e: Error) => void) | null = null;
  private err: Error | null = null;
  private done = false;

  constructor(sock: TcpSocket) {
    sock.on("data", (d: Buffer) => {
      if (this.done) return;
      this.buf = Buffer.concat([this.buf, d]);
      this.pump();
    });
  }

  take(n: number): Promise<Buffer> {
    return new Promise((res, rej) => {
      this.want = n;
      this.res = res;
      this.rej = rej;
      this.pump();
    });
  }

  fail(e: Error): void {
    this.err ??= e;
    this.pump();
  }

  stop(): void {
    this.done = true;
    this.buf = Buffer.alloc(0);
  }

  private pump(): void {
    if (this.res === null) return;
    if (this.buf.length >= this.want) {
      const out = Buffer.from(this.buf.subarray(0, this.want));
      this.buf = this.buf.subarray(this.want);
      const r = this.res;
      this.res = null;
      this.rej = null;
      r(out);
    } else if (this.err !== null) {
      const j = this.rej;
      this.res = null;
      this.rej = null;
      j?.(this.err);
    }
  }
}

type SendCb = (err: Error | null, bytes: number) => void;
type Queued = { datagram: Buffer; length: number; cb: SendCb | undefined };
type State = "idle" | "connecting" | "ready" | "failed" | "closed";

export type SocksOptions = {

  retryMs?: number;

  handshakeMs?: number;
  now?: () => number;
};

export class SocksUdpSocket extends EventEmitter {
  private readonly proxy: ProxyCfg;
  private readonly retryMs: number;
  private readonly handshakeMs: number;
  private readonly now: () => number;
  private state: State = "idle";
  private attempt = 0;
  private failedAt = 0;
  private tcp: TcpSocket | null = null;
  private udp: UdpSocket | null = null;
  private relayAddress = "";
  private relayPort = 0;
  private timer: NodeJS.Timeout | null = null;
  private queue: Queued[] = [];

  constructor(proxy: ProxyCfg, opts: SocksOptions = {}) {
    super();
    this.proxy = proxy;
    this.retryMs = opts.retryMs ?? RETRY_MS;
    this.handshakeMs = opts.handshakeMs ?? HANDSHAKE_MS;
    this.now = opts.now ?? Date.now;
  }

  bind(): this {
    if (this.state === "idle") this.start();
    return this;
  }

  send(msg: Uint8Array, offset: number, length: number, port: number, host: string, cb?: SendCb): void {
    try {
      if (this.state === "closed") return void cb?.(new Error("socket closed"), 0);
      const datagram = this.wrap(msg, offset, length, port, host);
      if (datagram === null) return void cb?.(new Error("bad destination"), 0);
      if (this.state === "failed") {
        if (this.now() - this.failedAt < this.retryMs) return void cb?.(new Error("proxy unavailable"), 0);
        this.start();
      } else if (this.state === "idle") this.start();
      if (this.state === "ready") this.out({ datagram, length, cb });
      else {
        this.queue.push({ datagram, length, cb });
        if (this.queue.length > QUEUE_MAX) this.queue.shift()?.cb?.(new Error("proxy queue full"), 0);
      }
    } catch (err) {
      cb?.(err instanceof Error ? err : new Error(String(err)), 0);
    }
  }

  close(cb?: () => void): void {
    if (this.state !== "closed") {
      this.state = "closed";
      this.attempt++;
      this.teardown();
      this.dropQueue(new Error("socket closed"));
    }
    if (cb !== undefined) process.nextTick(cb);
  }

  private wrap(msg: Uint8Array, offset: number, length: number, port: number, host: string): Buffer | null {
    const payload = Buffer.from(msg.buffer, msg.byteOffset + offset, length);
    let head: Buffer;
    if (isIPv4(host)) {
      head = Buffer.alloc(10);
      head[3] = 1;
      host.split(".").forEach((o, i) => (head[4 + i] = Number(o)));
      head.writeUInt16BE(port, 8);
    } else {
      const name = Buffer.from(host, "utf8");
      if (name.length === 0 || name.length > 255) return null;
      head = Buffer.alloc(7 + name.length);
      head[3] = 3;
      head[4] = name.length;
      name.copy(head, 5);
      head.writeUInt16BE(port, 5 + name.length);
    }
    return Buffer.concat([head, payload]);
  }

  private out(q: Queued): void {
    const udp = this.udp;
    if (udp === null) return void q.cb?.(new Error("proxy unavailable"), 0);
    udp.send(q.datagram, this.relayPort, this.relayAddress, (err) => q.cb?.(err ?? null, q.length));
  }

  private dropQueue(err: Error): void {
    const q = this.queue;
    this.queue = [];
    for (const e of q) e.cb?.(err, 0);
  }

  private teardown(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.tcp?.destroy();
    this.tcp = null;
    const udp = this.udp;
    this.udp = null;
    if (udp !== null) {
      udp.removeAllListeners();

      udp.on("error", () => {});
      try {
        udp.close();
      } catch {

      }
    }
  }

  private fail(attempt: number, msg: string): void {
    if (attempt !== this.attempt || this.state === "failed" || this.state === "closed") return;
    this.state = "failed";
    this.failedAt = this.now();
    this.teardown();
    this.dropQueue(new Error(msg));
    this.emit("proxyError", msg);
  }

  private start(): void {
    const attempt = ++this.attempt;
    this.state = "connecting";
    const tcp = connect({ host: this.proxy.host, port: this.proxy.port });
    this.tcp = tcp;
    tcp.setNoDelay(true);

    tcp.setKeepAlive(true, 30_000);
    const rd = new Reader(tcp);
    const label = proxyLabel(this.proxy);
    this.timer = setTimeout(() => this.fail(attempt, t("Прокси {proxy} не ответило за {s} с", { proxy: label, s: Math.round(this.handshakeMs / 1000) })), this.handshakeMs);
    this.timer.unref();

    const ended = (what: string): void => {
      const msg = t("Прокси {proxy} недоступно: {err}", { proxy: label, err: what });
      rd.fail(new Error(msg));
      if (this.state === "ready") this.fail(attempt, t("Прокси {proxy} закрыло соединение, связь потеряна", { proxy: label }));

      else setImmediate(() => this.fail(attempt, msg));
    };
    tcp.on("error", (e: Error) => ended(e.message));
    tcp.on("close", () => ended(t("соединение закрыто")));
    this.negotiate(attempt, tcp, rd, label).then(
      () => rd.stop(),
      (err: unknown) => this.fail(attempt, err instanceof Error ? err.message : String(err)),
    );
  }

  private async negotiate(attempt: number, tcp: TcpSocket, rd: Reader, label: string): Promise<void> {
    const p = this.proxy;
    const auth = p.user !== undefined;
    const protocol = (): Error => new Error(t("Прокси {proxy} ответило не по протоколу SOCKS5", { proxy: label }));
    tcp.write(Buffer.from(auth ? [5, 2, 0, 2] : [5, 1, 0]));
    const sel = await rd.take(2);
    if (sel[0] !== 5) throw protocol();
    if (sel[1] === 0xff) throw new Error(auth ? t("Прокси {proxy} не приняло вход", { proxy: label }) : t("Прокси {proxy} просит логин и пароль", { proxy: label }));
    if (sel[1] === 2 && auth) {
      const u = Buffer.from(p.user ?? "", "utf8");
      const w = Buffer.from(p.pass ?? "", "utf8");
      tcp.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([w.length]), w]));
      const ans = await rd.take(2);
      if (ans[1] !== 0) throw new Error(t("Прокси {proxy} не приняло логин или пароль", { proxy: label }));
    } else if (sel[1] !== 0) throw protocol();
    tcp.write(Buffer.from([5, 3, 0, 1, 0, 0, 0, 0, 0, 0]));
    const head = await rd.take(4);
    if (head[0] !== 5) throw protocol();
    if (head[1] !== 0) {
      throw new Error(head[1] === 7 ? t("Прокси не поддерживает UDP (нужен SOCKS5 с UDP ASSOCIATE)") : t("Прокси {proxy} отказало, код {code}", { proxy: label, code: head[1] }));
    }
    let address: string;
    if (head[3] === 1) {
      const a = await rd.take(4);
      address = `${a[0]}.${a[1]}.${a[2]}.${a[3]}`;
    } else if (head[3] === 3) {
      const len = (await rd.take(1))[0];
      address = (await rd.take(len)).toString("utf8");
    } else if (head[3] === 4) {
      const a = await rd.take(16);
      const g: string[] = [];
      for (let i = 0; i < 16; i += 2) g.push(a.readUInt16BE(i).toString(16));
      address = g.join(":");
    } else throw protocol();
    const port = (await rd.take(2)).readUInt16BE(0);

    if (address === "0.0.0.0" || address === "0:0:0:0:0:0:0:0" || address === "::" || address === "") address = tcp.remoteAddress ?? p.host;
    else if (!isIPv4(address) && !isIPv6(address)) address = (await lookup(address)).address;

    const reached = tcp.remoteAddress;
    if (reached !== undefined && isPrivate(address) && !isPrivate(reached)) {
      if (isIPv4(address) === isIPv4(reached)) address = reached;
      else if (isIPv4(address) && !isIPv4(p.host) && !isIPv6(p.host)) {
        const v4 = await lookup(p.host, { family: 4 }).catch(() => null);
        if (v4 !== null && !isPrivate(v4.address)) address = v4.address;
      }
    }
    address = canon(address);
    if (attempt !== this.attempt || this.state !== "connecting") return;
    const udp = createSocket(isIPv6(address) ? "udp6" : "udp4");
    udp.on("error", (e: Error) => this.fail(attempt, t("Прокси {proxy}: ошибка UDP: {err}", { proxy: label, err: e.message })));
    udp.on("message", (m: Buffer, r: RemoteInfo) => this.incoming(attempt, m, r));
    await new Promise<void>((res, rej) => {
      udp.once("error", rej);
      udp.bind(0, () => {
        udp.removeListener("error", rej);
        res();
      });
    }).catch((e: unknown) => {
      udp.close();
      throw e;
    });
    if (attempt !== this.attempt || this.state !== "connecting") {
      udp.removeAllListeners();
      udp.on("error", () => {});
      udp.close();
      return;
    }
    this.udp = udp;
    this.relayAddress = address;
    this.relayPort = port;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.state = "ready";
    const q = this.queue;
    this.queue = [];
    for (const e of q) this.out(e);
  }

  private incoming(attempt: number, m: Buffer, r: RemoteInfo): void {
    if (attempt !== this.attempt || this.state !== "ready") return;
    if (r.port !== this.relayPort || canon(r.address) !== this.relayAddress) return;
    if (m.length < 10 || m[2] !== 0) return;
    let address: string;
    let at: number;
    if (m[3] === 1) {
      address = `${m[4]}.${m[5]}.${m[6]}.${m[7]}`;
      at = 8;
    } else if (m[3] === 3) {
      const len = m[4];
      if (m.length < 7 + len) return;
      address = m.toString("utf8", 5, 5 + len);
      at = 5 + len;
    } else if (m[3] === 4) {
      if (m.length < 22) return;
      const g: string[] = [];
      for (let i = 0; i < 16; i += 2) g.push(m.readUInt16BE(4 + i).toString(16));
      address = canon(g.join(":"));
      at = 20;
    } else return;
    const port = m.readUInt16BE(at);
    const payload = Buffer.from(m.subarray(at + 2));
    this.emit("message", payload, { address, family: isIPv6(address) ? "IPv6" : "IPv4", port, size: payload.length });
  }
}

type Socketed = { socket?: unknown };

export function installProxy(client: object, proxy: ProxyCfg, onError: (msg: string) => void, opts: SocksOptions = {}): void {
  const c = client as Socketed;
  let current: unknown = undefined;
  const adopt = (value: unknown): void => {
    if (value === undefined) {
      current = undefined;
      return;
    }
    if (value instanceof SocksUdpSocket) {
      current = value;
      return;
    }
    const real = value as { close?: () => void; removeAllListeners?: (event?: string) => unknown; on?: (e: string, f: () => void) => unknown } | null;
    try {
      real?.removeAllListeners?.("message");
      real?.on?.("error", () => {});
      real?.close?.();
    } catch {

    }
    const s = new SocksUdpSocket(proxy, opts);
    s.on("proxyError", onError);
    current = s;
  };
  const had = c.socket;
  Object.defineProperty(c, "socket", { configurable: true, enumerable: true, get: () => current, set: adopt });
  adopt(had);
}
