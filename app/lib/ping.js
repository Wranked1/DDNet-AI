"use strict";

const dgram = require("node:dgram");
const crypto = require("node:crypto");
const net = require("node:net");
const { performance } = require("node:perf_hooks");

const GETINFO = Buffer.from([255, 255, 255, 255, 0x67, 0x69, 0x65, 0x33]);
const REPLIES = new Set(["inf3", "iext"]);

const OCTET = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const ADDR_RE = new RegExp(`^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}:([1-9]\\d{0,4})$`);

function pingable(address) {
  if (typeof address !== "string") return false;
  const m = ADDR_RE.exec(address);
  if (m === null) return false;
  const first = Number(m[1]);
  return Number(m[5]) <= 65535 && first !== 0 && first < 224;
}

function literal(host, opts, cb) {
  const done = typeof opts === "function" ? opts : cb;
  if (net.isIPv4(host)) process.nextTick(done, null, host, 4);
  else process.nextTick(done, new Error("not an IPv4 address"));
}

function request(token) {
  const b = Buffer.alloc(6 + GETINFO.length + 1);
  b[0] = 0x78;
  b[1] = 0x65;
  b[2] = (token >> 16) & 0xff;
  b[3] = (token >> 8) & 0xff;
  GETINFO.copy(b, 6);
  b[6 + GETINFO.length] = token & 0xff;
  return b;
}

function answers(buf, token) {
  if (!Buffer.isBuffer(buf) || buf.length < 6 + 8 + 2) return false;
  for (let i = 0; i < 10; i++) if (buf[i] !== 255) return false;
  const type = buf.toString("latin1", 10, 14);
  if (!REPLIES.has(type)) return false;
  const end = buf.indexOf(0, 14);
  if (end < 0 || end - 14 > 11) return false;
  const text = buf.toString("latin1", 14, end);
  return /^\d+$/.test(text) && Number(text) === (type === "iext" ? token : token & 0xff);
}

function createPinger(opts = {}) {
  const allow = typeof opts.allow === "function" ? opts.allow : () => false;
  const offline = typeof opts.offline === "function" ? opts.offline : () => opts.offline === true;
  const ratePerSec = opts.ratePerSec > 0 ? opts.ratePerSec : 20;
  const batch = opts.batch > 0 ? Math.floor(opts.batch) : 5;
  const timeoutMs = opts.timeoutMs > 0 ? opts.timeoutMs : 1500;
  const maxAge = opts.maxAge >= 0 ? opts.maxAge : 30_000;
  const maxPerCall = opts.maxPerCall > 0 ? opts.maxPerCall : 60;

  const now = typeof opts.now === "function" ? opts.now : () => performance.now();
  const gap = Math.ceil((batch * 1000) / ratePerSec);

  const cache = new Map();
  const pending = new Map();
  const inflight = new Map();
  const queue = [];
  let socket = null;
  let timer = null;
  let closed = false;

  function open() {
    if (socket !== null) return socket;
    const s = dgram.createSocket({ type: "udp4", lookup: literal });
    s.on("error", () => {});
    s.on("message", (msg, rinfo) => {
      const job = inflight.get(`${rinfo.address}:${rinfo.port}`);
      if (job === undefined || !answers(msg, job.token)) return;
      job.done(Math.max(1, Math.round(Number(process.hrtime.bigint() - job.t0) / 1e6)));
    });
    socket = s;
    return s;
  }

  function idle() {
    if (socket !== null && inflight.size === 0 && queue.length === 0) {
      const s = socket;
      socket = null;
      try {
        s.close();
      } catch {

      }
    }
  }

  function send(job) {
    const cut = job.address.lastIndexOf(":");
    const host = job.address.slice(0, cut);
    const port = Number(job.address.slice(cut + 1));
    const token = crypto.randomBytes(3).readUIntBE(0, 3);
    let finished = false;
    const entry = {
      token,
      t0: process.hrtime.bigint(),
      done: (ms) => {
        if (finished) return;
        finished = true;
        clearTimeout(to);
        inflight.delete(job.address);
        job.resolve(ms);
        idle();
      },
    };
    const to = setTimeout(() => entry.done(null), timeoutMs);
    inflight.set(job.address, entry);
    try {
      open().send(request(token), port, host, (err) => {
        if (err) entry.done(null);
      });
    } catch {
      entry.done(null);
    }
  }

  function pump() {
    for (let n = 0; n < batch && queue.length > 0; n++) send(queue.shift());
    timer = setTimeout(() => {
      timer = null;
      if (queue.length > 0) pump();
    }, gap);
  }

  function enqueue(job) {
    queue.push(job);
    if (timer === null) timer = setTimeout(pump, 0);
  }

  function one(address) {
    const hit = cache.get(address);
    const age = hit === undefined ? -1 : now() - hit.at;
    if (age >= 0 && age < maxAge) return Promise.resolve(hit.ms);
    const wait = pending.get(address);
    if (wait !== undefined) return wait;
    const p = new Promise((resolve) => enqueue({ address, resolve })).then((ms) => {
      pending.delete(address);
      cache.set(address, { at: now(), ms });
      return ms;
    });
    pending.set(address, p);
    return p;
  }

  async function ping(addresses) {
    if (closed || offline() || !Array.isArray(addresses)) return {};
    const want = [];
    for (const a of addresses) {
      if (want.length >= maxPerCall) break;
      if (!want.includes(a) && pingable(a) && allow(a) === true) want.push(a);
    }
    const out = {};
    const got = await Promise.all(want.map(one));
    want.forEach((a, i) => {
      out[a] = got[i];
    });
    return out;
  }

  function close() {
    closed = true;
    clearTimeout(timer);
    timer = null;
    for (const job of queue.splice(0)) job.resolve(null);
    for (const e of [...inflight.values()]) e.done(null);
    idle();
  }

  return { ping, close };
}

module.exports = { createPinger, pingable, request, answers, literal };
