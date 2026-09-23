"use strict";

const path = require("node:path");

function isProjectRoot(dir, exists) {
  return exists(path.join(dir, "start.mjs")) && exists(path.join(dir, "src", "bot", "web.ts"));
}

function findProjectRoot(starts, exists, maxUp = 6) {
  for (const start of starts) {
    if (typeof start !== "string" || start === "") continue;
    let dir = path.resolve(start);
    for (let i = 0; i <= maxUp; i++) {
      if (isProjectRoot(dir, exists)) return dir;

      for (const sib of ["ddnet-ai", "AiDDNet"]) {
        const cand = path.join(dir, sib);
        if (isProjectRoot(cand, exists)) return cand;
      }
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  return null;
}

function nodeCandidates(env, platform) {
  const win = platform === "win32";
  const exe = win ? "node.exe" : "node";
  const join = win ? path.win32.join : path.posix.join;
  const out = [];
  if (env.DDNET_AI_NODE) out.push(env.DDNET_AI_NODE);
  const pathVar = env.PATH ?? env.Path ?? "";
  for (const dir of pathVar.split(win ? ";" : ":")) {
    const d = dir.trim().replace(/^"(.*)"$/, "$1");
    if (d !== "") out.push(join(d, exe));
  }
  if (win) {
    for (const base of [env.ProgramFiles, env["ProgramFiles(x86)"], env.ProgramW6432]) {
      if (base) out.push(join(base, "nodejs", exe));
    }
    if (env.LOCALAPPDATA) {
      out.push(join(env.LOCALAPPDATA, "Programs", "nodejs", exe));
      out.push(join(env.LOCALAPPDATA, "Volta", "bin", exe));
    }
    if (env.NVM_SYMLINK) out.push(join(env.NVM_SYMLINK, exe));
    if (env.USERPROFILE) out.push(join(env.USERPROFILE, "scoop", "apps", "nodejs", "current", exe));
  } else {
    for (const d of ["/usr/local/bin", "/usr/bin", "/opt/homebrew/bin"]) out.push(join(d, exe));
    if (env.HOME) out.push(join(env.HOME, ".volta", "bin", exe));
  }
  const seen = new Set();
  return out.filter((p) => {
    const key = win ? p.toLowerCase() : p;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function nodeMajor(version) {
  const m = /^v?(\d+)\./.exec(typeof version === "string" ? version.trim() : "");
  return m === null ? 0 : Number(m[1]);
}

function pickNode(candidates, probe, minMajor = 24) {
  const tooOld = [];
  for (const c of candidates) {
    const v = probe(c);
    if (v === null) continue;
    if (nodeMajor(v) >= minMajor) return { kind: "system", path: c, version: v.trim(), tooOld };
    tooOld.push({ path: c, version: v.trim() });
  }
  return { kind: "embedded", path: null, version: null, tooOld };
}

function botArgs({ port, offline = false, extra = [] }) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("bad port");
  const args = ["start.mjs", "--no-open", "--no-console", "--ready-line", "--web-port", String(port)];

  if (offline) args.push("--server", "127.0.0.1:1", "--no-update");
  for (const e of extra) if (typeof e === "string") args.push(e);
  return args;
}

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;
function stripAnsi(s) {
  return String(s).replace(ANSI_RE, "");
}

function parseControlLine(line) {
  const t = stripAnsi(line).trim();
  let m = /^WEBUI_READY (\d{1,5})$/.exec(t);
  if (m !== null) return { kind: "ready", port: Number(m[1]) };

  m = /^\u25b8 http:\/\/localhost:(\d{1,5})(?:\s|$)/.exec(t);
  if (m !== null) return { kind: "ready", port: Number(m[1]) };
  m = /^WEBUI_FAIL (.*)$/.exec(t);
  if (m !== null) return { kind: "fail", reason: m[1] };
  m = /обновлено до ([0-9a-f]{7,40})/.exec(t);
  if (m !== null) return { kind: "updated", sha: m[1] };
  return null;
}

module.exports = { isProjectRoot, findProjectRoot, nodeCandidates, nodeMajor, pickNode, botArgs, stripAnsi, parseControlLine };
