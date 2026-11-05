"use strict";

const CLI = "src/bot/proxyTestCli.ts";

const FAILED = "Проверка прокси не запустилась";
const TIMEOUT = "Проверка прокси не уложилась в срок";
const NONE = "Прокси не задан";

function runProxyTest({ runtime, root, text, spawn = require("node:child_process").spawn, timeoutMs = 20_000 }) {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (trimmed === "") return Promise.resolve({ ok: false, error: NONE, ms: 0 });
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    let child = null;
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child?.kill();
      } catch {

      }
      resolve(r);
    };
    const timer = setTimeout(() => done({ ok: false, error: TIMEOUT, ms: timeoutMs }), timeoutMs);
    try {
      child = spawn(runtime.command, [...runtime.prefixArgs, CLI], { cwd: root, env: runtime.env, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
      child.on("error", () => done({ ok: false, error: FAILED, ms: 0 }));

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (d) => {
        out += d;
      });
      child.on("close", () => {
        try {
          const r = JSON.parse(out.trim().split("\n").pop() ?? "");
          if (r !== null && typeof r === "object" && typeof r.ok === "boolean") return done({ ok: r.ok, error: typeof r.error === "string" ? r.error : "", ms: Number.isFinite(r.ms) ? r.ms : 0 });
        } catch {

        }
        done({ ok: false, error: FAILED, ms: 0 });
      });
      child.stdin.on("error", () => {});
      child.stdin.end(trimmed);
    } catch {
      done({ ok: false, error: FAILED, ms: 0 });
    }
  });
}

module.exports = { runProxyTest, FAILED, TIMEOUT, NONE };
