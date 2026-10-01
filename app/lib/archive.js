"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DIRS = ["runs/clips", "runs/memory"];
const FILES = ["runs/ab.json", "runs/ab.prev.json", ".version"];

const MAX_FILES_PER_DIR = 400;

function walk(dir, fsApi, out, depth = 0) {
  if (depth > 4) return;
  let names;
  try {
    names = fsApi.readdirSync(dir);
  } catch {
    return;
  }
  for (const n of names) {
    const full = path.join(dir, n);
    let st;
    try {
      st = fsApi.statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, fsApi, out, depth + 1);
    else if (st.isFile()) out.push({ full, mtime: st.mtimeMs, size: st.size });
  }
}

const SECRET_NAMES = /^(password|pass|passwd|key|apikey|api_key|token|secret|rconpassword)$/i;

function withoutSecrets(value) {
  if (Array.isArray(value)) return value.map(withoutSecrets);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!SECRET_NAMES.test(k)) out[k] = withoutSecrets(v);
    return out;
  }
  return value;
}

function planArchive(root, { demos = [], logText = "", settings = null, fsApi = fs } = {}) {
  const entries = [];
  const skipped = [];
  for (const rel of DIRS) {
    const found = [];
    walk(path.join(root, rel), fsApi, found);
    found.sort((a, b) => b.mtime - a.mtime);

    for (const f of found.slice(0, MAX_FILES_PER_DIR)) {
      entries.push({ name: path.relative(root, f.full).split(path.sep).join("/"), file: f.full, optional: true });
    }
    if (found.length > MAX_FILES_PER_DIR) skipped.push(`${rel}: ещё ${found.length - MAX_FILES_PER_DIR} старых файлов не взято`);
  }
  for (const rel of FILES) {
    const full = path.join(root, rel);
    try {
      if (fsApi.statSync(full).isFile()) entries.push({ name: rel, file: full });
    } catch {

    }
  }
  const usedDemo = new Set();
  for (const d of demos) {
    if (typeof d !== "string" || !d.toLowerCase().endsWith(".demo")) continue;
    let base = path.basename(d);
    while (usedDemo.has(base)) base = "_" + base;
    usedDemo.add(base);
    entries.push({ name: `demos/${base}`, file: d });
  }
  if (logText !== "") entries.push({ name: "app-log.txt", data: logText });
  if (settings !== null && typeof settings === "object") {
    entries.push({ name: "settings.json", data: JSON.stringify(withoutSecrets(settings), null, 2) });
  }
  return { entries, skipped };
}

function archiveName(now) {
  const p = (n) => String(n).padStart(2, "0");
  return `runs-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}.zip`;
}

function freeArchivePath(dir, name, exists = fs.existsSync) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let out = path.join(dir, name);
  for (let i = 2; exists(out); i++) out = path.join(dir, `${base} (${i})${ext}`);
  return out;
}

module.exports = { planArchive, archiveName, freeArchivePath, DIRS, FILES, MAX_FILES_PER_DIR };
