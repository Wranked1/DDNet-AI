"use strict";

const fs = require("node:fs");
const path = require("node:path");

const LOGIC = require("../ui/logic.js");

const MAX_SKIN_BYTES = 4 * 1024 * 1024;
const MAX_LIST = 3000;
const CLIENT_FOLDER = /^(ddnet|ddracenetwork|tclient|tater[ _-]?client|cactus|best[ _-]?client|chillerbot|entity[ _-]?client|aiodob|fclient|kaizo)/i;

function dataDirCandidates(env, platform) {
  const home = env.USERPROFILE ?? env.HOME ?? "";
  const out = [];
  const add = (p) => {
    if (p !== null && p !== "" && !out.includes(p)) out.push(p);
  };
  const pf = env.ProgramFiles ?? "C:\\Program Files";
  const pf86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  if (platform === "win32") {
    add(path.join(pf86, "Steam", "steamapps", "common", "DDraceNetwork", "ddnet", "data"));
    add(path.join(pf, "Steam", "steamapps", "common", "DDraceNetwork", "ddnet", "data"));
    for (const d of ["C", "D", "E", "F"]) add(`${d}:\\SteamLibrary\\steamapps\\common\\DDraceNetwork\\ddnet\\data`);
    add(path.join(pf, "DDNet", "data"));
    add(path.join(pf86, "DDNet", "data"));
    if (env.LOCALAPPDATA) add(path.join(env.LOCALAPPDATA, "DDNet", "data"));
    if (env.APPDATA) add(path.join(env.APPDATA, "DDNet", "data"));
  }
  if (home !== "") {
    add(path.join(home, "DDNet", "data"));
    add(path.join(home, ".local", "share", "Steam", "steamapps", "common", "DDraceNetwork", "ddnet", "data"));
    add(path.join(home, ".steam", "steam", "steamapps", "common", "DDraceNetwork", "ddnet", "data"));
    add(path.join(home, ".local", "share", "ddnet", "data"));
  }
  add("/usr/share/ddnet/data");
  add("/usr/local/share/ddnet/data");
  add(path.join("vendor", "DDNet-20.0-linux_x86_64", "data"));
  add(path.join("vendor", "DDNet-20.0", "data"));
  return out;
}

function userDirCandidates(env) {
  const home = env.USERPROFILE ?? env.HOME ?? "";
  const out = [];
  if (env.APPDATA) out.push(path.join(env.APPDATA, "DDNet"), path.join(env.APPDATA, "Teeworlds"));
  if (home !== "") {
    out.push(path.join(home, "AppData", "Roaming", "DDNet"));
    out.push(path.join(home, ".local", "share", "ddnet"));
    out.push(path.join(home, "Library", "Application Support", "DDNet"));
    out.push(path.join(home, ".teeworlds"));
  }
  return [...new Set(out)];
}

function safeList(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function readText(file) {
  try {
    return fs.statSync(file).size > 1024 * 1024 ? null : fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function vdfPaths(text) {
  const out = [];
  for (const m of text.matchAll(/"path"\s+"((?:[^"\\]|\\.)*)"/gi)) out.push(m[1].replace(/\\(.)/g, "$1"));
  return out;
}

function steamLibraryData(env, platform, read = readText) {
  const home = env.USERPROFILE ?? env.HOME ?? "";
  const roots = [];
  if (platform === "win32") {
    roots.push(path.join(env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Steam"), path.join(env.ProgramFiles ?? "C:\\Program Files", "Steam"));
  } else if (home !== "") {
    roots.push(path.join(home, ".local", "share", "Steam"), path.join(home, ".steam", "steam"), path.join(home, "Library", "Application Support", "Steam"));
  }
  const out = [];
  for (const root of roots) {
    for (const vdf of [path.join(root, "steamapps", "libraryfolders.vdf"), path.join(root, "config", "libraryfolders.vdf")]) {
      const text = read(vdf);
      if (text === null) continue;
      for (const lib of vdfPaths(text)) {
        const d = path.join(lib, "steamapps", "common", "DDraceNetwork", "ddnet", "data");
        if (!out.includes(d)) out.push(d);
      }
    }
  }
  return out;
}

function scanForUnpacked(env, list = safeList, platform = process.platform) {
  const home = env.USERPROFILE ?? env.HOME ?? "";
  const bases = [];
  if (home !== "") bases.push(home, path.join(home, "Desktop"), path.join(home, "OneDrive", "Desktop"), path.join(home, "Downloads"), path.join(home, "Games"), path.join(home, "Documents"));
  if (platform === "win32") {
    for (const b of [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Programs") : undefined, env.LOCALAPPDATA]) {
      if (b !== undefined && b !== "") bases.push(b);
    }
    for (const d of ["C", "D", "E", "F"]) bases.push(`${d}:\\`, `${d}:\\Games`);
  }
  const out = [];
  for (const base of bases) {
    for (const name of list(base)) {
      if (!CLIENT_FOLDER.test(name)) continue;
      out.push(path.join(base, name, "data"), path.join(base, name, "ddnet", "data"));
      for (const inner of list(path.join(base, name))) {
        if (CLIENT_FOLDER.test(inner)) out.push(path.join(base, name, inner, "data"));
      }
    }
  }
  return out;
}

const looksLikeData = (dir, exists) => exists(path.join(dir, "game.png")) || exists(path.join(dir, "audio"));

function typedDataDir(typed, exists = fs.existsSync) {
  let dir = String(typed || "").trim();
  if (dir.length >= 2 && ((dir.startsWith('"') && dir.endsWith('"')) || (dir.startsWith("'") && dir.endsWith("'")))) dir = dir.slice(1, -1).trim();
  if (dir === "") return null;
  for (const c of [dir, path.join(dir, "data"), path.join(dir, "ddnet", "data")]) {
    if (exists(path.join(c, "game.png"))) return c;
  }
  return null;
}

function findDataDir({ env, platform, root, ddnetData, exists = fs.existsSync, list = safeList }) {
  if (typeof ddnetData === "string" && ddnetData.trim() !== "") {
    const typed = typedDataDir(ddnetData, exists);
    if (typed !== null) return typed;
  }
  const cands = [...dataDirCandidates(env, platform)];
  cands.splice(cands.length - 2, 0, ...steamLibraryData(env, platform), ...scanForUnpacked(env, list, platform));
  const abs = (c) => (path.isAbsolute(c) || root === null ? c : path.join(root, c));
  const hit = cands.map(abs).find((c) => looksLikeData(c, exists));
  return hit === undefined ? null : hit;
}

function skinFolders({ env, platform, root, ddnetData, dataDir }) {

  const data = dataDir !== undefined ? dataDir : findDataDir({ env, platform, root, ddnetData });
  const out = [];
  if (data !== null) out.push(path.join(data, "skins"));
  for (const u of userDirCandidates(env)) out.push(path.join(u, "skins"), path.join(u, "downloadedskins"));
  if (root !== null) out.push(path.join(root, "runs", "skincache"));
  return { folders: out, data };
}

function listSkins(opts) {
  const { folders, data } = skinFolders(opts);
  const seen = new Map();
  for (const dir of folders) {
    for (const f of safeList(dir)) {
      if (!f.toLowerCase().endsWith(".png")) continue;
      const name = f.slice(0, -4);
      if (!LOGIC.isSkinName(name) || seen.has(name.toLowerCase())) continue;
      seen.set(name.toLowerCase(), name);
      if (seen.size >= MAX_LIST) break;
    }
  }
  const names = [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return { names, found: data !== null || names.length > 0 };
}

function readSkin(name, opts) {
  if (!LOGIC.isSkinName(name)) return null;
  for (const dir of skinFolders(opts).folders) {
    const file = path.join(dir, `${name}.png`);
    if (path.dirname(file) !== dir) continue;
    try {
      const st = fs.statSync(file);
      if (!st.isFile() || st.size > MAX_SKIN_BYTES) continue;
      const buf = fs.readFileSync(file);
      if (buf.length < 9 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) continue;
      return `data:image/png;base64,${buf.toString("base64")}`;
    } catch {

    }
  }
  return null;
}

module.exports = { dataDirCandidates, userDirCandidates, steamLibraryData, scanForUnpacked, typedDataDir, findDataDir, skinFolders, listSkins, readSkin, MAX_SKIN_BYTES };
