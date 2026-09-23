"use strict";

const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const http = require("node:http");
const net = require("node:net");

const { RestartPolicy, LineSplitter } = require("./supervisor.js");
const { botArgs, parseControlLine, stripAnsi } = require("./runtime.js");

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => resolve(typeof addr === "object" && addr !== null ? addr.port : 0));
    });
  });
}

async function pickPort(preferred) {
  if (Number.isInteger(preferred) && preferred > 0 && (await portFree(preferred))) return preferred;
  return freePort();
}

function request(port, method, pathname, body, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path: pathname,
        timeout: timeoutMs,
        headers: data === null ? {} : { "content-type": "application/json", "content-length": data.length },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve(JSON.parse(text));
          } catch {
            resolve(text);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (data !== null) req.write(data);
    req.end();
  });
}

function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  if (process.platform === "win32") {

    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } catch {
      child.kill();
    }
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  const t = setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {

    }
  }, 1500);
  t.unref();
}

class BotSupervisor extends EventEmitter {
  constructor({ root, runtime, preferredPort = 7777, offline = false, readyTimeoutMs = 90_000 }) {
    super();
    this.root = root;
    this.runtime = runtime;
    this.preferredPort = preferredPort;
    this.offline = offline;
    this.readyTimeoutMs = readyTimeoutMs;
    this.policy = new RestartPolicy();
    this.child = null;
    this.port = 0;
    this.state = "idle";
    this.startedAt = 0;
    this.planned = false;
    this.updated = false;
    this.restartTimer = null;
    this.readyTimer = null;
    this.forceFreePort = false;
    this.spawning = false;
    this.runs = 0;
  }

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.emit("state", s);
  }

  async start() {

    if (this.child !== null || this.spawning || this.state === "stopped") return;
    this.spawning = true;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.setState("starting");
    try {
      this.port = this.forceFreePort ? await freePort() : await pickPort(this.preferredPort);
    } finally {
      this.spawning = false;
    }
    this.forceFreePort = false;
    if (this.state === "stopped") return;
    const args = [...this.runtime.prefixArgs, ...botArgs({ port: this.port, offline: this.offline })];
    let child;
    try {
      child = spawn(this.runtime.command, args, {
        cwd: this.root,
        env: this.runtime.env,

        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        detached: process.platform !== "win32",
      });
    } catch (err) {
      this.emit("line", { stream: "app", text: `не удалось запустить бота: ${err.message}` });
      this.scheduleRestart(0);
      return;
    }
    this.child = child;
    this.runs++;
    this.startedAt = Date.now();
    this.planned = false;
    this.updated = false;
    this.emit("spawn", { pid: child.pid, port: this.port, args });
    const onLine = (stream) => (raw) => {
      const text = stripAnsi(raw);
      const ctl = parseControlLine(text);
      if (ctl !== null) this.onControl(ctl);

      if (!text.startsWith("WEBUI_")) this.emit("line", { stream, text });
    };
    const out = new LineSplitter(onLine("out"));
    const errs = new LineSplitter(onLine("err"));
    child.stdout.on("data", (c) => out.write(c));
    child.stderr.on("data", (c) => errs.write(c));
    child.once("error", (err) => {
      this.emit("line", { stream: "app", text: `ошибка процесса бота: ${err.message}` });
    });
    child.once("close", (code, signal) => {
      out.end();
      errs.end();
      clearTimeout(this.readyTimer);
      this.child = null;
      const uptimeMs = Date.now() - this.startedAt;
      const planned = this.planned || this.updated;
      this.emit("exit", { code, signal, uptimeMs, planned, updated: this.updated });
      if (this.state === "stopped") return;
      const { delayMs, crashLoop } = this.policy.onExit({ uptimeMs, planned });
      if (crashLoop) this.emit("crashloop", { code });
      this.scheduleRestart(delayMs);
    });
    this.readyTimer = setTimeout(() => {
      if (this.state === "starting") this.emit("slow", { afterMs: this.readyTimeoutMs });
    }, this.readyTimeoutMs);
  }

  onControl(ctl) {
    if (ctl.kind === "ready") {

      if (this.state === "running" && this.port === ctl.port) return;
      clearTimeout(this.readyTimer);
      this.port = ctl.port;
      this.setState("running");
      this.emit("ready", { port: ctl.port });
    } else if (ctl.kind === "fail") {

      this.emit("line", { stream: "app", text: `страница бота не поднялась: ${ctl.reason}` });
      this.forceFreePort = true;
      this.planned = true;
      if (this.child !== null) killTree(this.child);
    } else if (ctl.kind === "updated") {
      this.updated = true;
      this.emit("updated", { sha: ctl.sha });
    }
  }

  scheduleRestart(delayMs) {
    if (this.state === "stopped") return;
    this.setState("waiting");
    this.emit("waiting", { delayMs });
    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.start();
    }, delayMs);
  }

  async shutdownChild(graceMs, pageUp) {
    const child = this.child;
    if (child === null) return;
    const exited = new Promise((resolve) => child.once("close", resolve));
    if (pageUp && this.port > 0) {
      request(this.port, "POST", "/cmd", { line: "!quit" }, 1000).catch(() => {});
    }
    const timer = new Promise((resolve) => setTimeout(resolve, graceMs));
    await Promise.race([exited, timer]);
    if (this.child === child) {
      killTree(child);
      await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    }
  }

  async restart() {
    if (this.state === "stopped") this.state = "idle";
    this.policy.reset();
    if (this.child === null) {
      clearTimeout(this.restartTimer);

      if (this.spawning) return;
      return this.start();
    }
    this.planned = true;
    await this.shutdownChild(2500, this.state === "running");
  }

  async stop(graceMs = 2500) {
    const pageUp = this.state === "running";
    this.setState("stopped");
    clearTimeout(this.restartTimer);
    clearTimeout(this.readyTimer);
    await this.shutdownChild(graceMs, pageUp);
  }

  killNow() {
    if (this.child !== null) killTree(this.child);
  }

  command(line) {
    if (this.state !== "running") return Promise.reject(new Error("бот ещё не запущен"));
    return request(this.port, "POST", "/cmd", { line });
  }

  status() {
    if (this.state !== "running") return Promise.reject(new Error("бот ещё не запущен"));
    return request(this.port, "GET", "/api", undefined, 2000);
  }
}

module.exports = { BotSupervisor, pickPort, portFree, freePort, request, killTree };
