"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_HOTKEY = "CommandOrControl+Shift+F9";

const DEFAULTS = Object.freeze({
  bounds: null,
  maximized: false,
  miniBounds: null,
  hotkey: DEFAULT_HOTKEY,
  closeToTray: true,
  notifications: true,
  webPort: 7777,
  favorites: [],
  recent: [],
  logOpen: false,
  logHeight: 0,
  trayHintShown: false,
  projectRoot: "",
  lang: "auto",
});

const LANGS = new Set(["auto", "ru", "en"]);

const MODIFIERS = new Set(["Command", "Cmd", "Control", "Ctrl", "CommandOrControl", "CmdOrCtrl", "Alt", "Option", "AltGr", "Shift", "Super", "Meta"]);
const NAMED_KEYS = new Set([
  "Plus", "Space", "Tab", "Backspace", "Delete", "Insert", "Return", "Enter", "Up", "Down", "Left", "Right",
  "Home", "End", "PageUp", "PageDown", "Escape", "Esc", "PrintScreen", "Pause",
  "num0", "num1", "num2", "num3", "num4", "num5", "num6", "num7", "num8", "num9",
  "numadd", "numsub", "nummult", "numdiv", "numdec",
]);

function isValidAccelerator(text) {
  if (typeof text !== "string" || text.length === 0 || text.length > 64) return false;
  const parts = text.split("+");
  if (parts.some((p) => p === "")) return false;
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  if (!mods.every((m) => MODIFIERS.has(m))) return false;
  if (new Set(mods).size !== mods.length) return false;
  const isF = /^F([1-9]|1\d|2[0-4])$/.test(key);
  const isChar = /^[A-Z0-9]$/.test(key) || /^[`\-=\[\]\\;',./]$/.test(key);
  if (!isF && !isChar && !NAMED_KEYS.has(key)) return false;
  if (mods.length === 0 && !isF && key !== "Pause") return false;
  return true;
}

function isBounds(b) {
  return (
    b !== null &&
    typeof b === "object" &&
    ["x", "y", "width", "height"].every((k) => Number.isFinite(b[k])) &&
    b.width >= 200 &&
    b.height >= 150 &&
    b.width <= 20000 &&
    b.height <= 20000
  );
}

function isAddress(a) {
  return typeof a === "string" && /^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/.test(a);
}

function sanitize(raw) {
  const src = raw !== null && typeof raw === "object" ? raw : {};
  const out = { ...DEFAULTS, favorites: [], recent: [] };
  if (isBounds(src.bounds)) out.bounds = pickBounds(src.bounds);
  if (isBounds(src.miniBounds)) out.miniBounds = pickBounds(src.miniBounds);
  for (const k of ["maximized", "closeToTray", "notifications", "logOpen", "trayHintShown"]) {
    if (typeof src[k] === "boolean") out[k] = src[k];
  }
  if (isValidAccelerator(src.hotkey)) out.hotkey = src.hotkey;
  if (LANGS.has(src.lang)) out.lang = src.lang;
  if (Number.isInteger(src.logHeight) && src.logHeight >= 0 && src.logHeight <= 5000) out.logHeight = src.logHeight;
  if (Number.isInteger(src.webPort) && src.webPort >= 1024 && src.webPort <= 65535) out.webPort = src.webPort;
  if (Array.isArray(src.favorites)) out.favorites = [...new Set(src.favorites.filter(isAddress))].slice(0, 200);
  if (Array.isArray(src.recent)) {
    out.recent = src.recent
      .filter((r) => r !== null && typeof r === "object" && isAddress(r.address))
      .map((r) => ({ address: r.address, name: typeof r.name === "string" ? r.name.slice(0, 128) : "", when: Number.isFinite(r.when) ? r.when : 0 }))
      .slice(0, 20);
  }
  if (typeof src.projectRoot === "string" && src.projectRoot.length < 1024) out.projectRoot = src.projectRoot;
  return out;
}

function pickBounds(b) {
  return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
}

const TITLE_H = 36;
function visibleBounds(bounds, workAreas) {
  if (!isBounds(bounds) || !Array.isArray(workAreas)) return null;
  for (const a of workAreas) {
    const w = Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x);
    const top = Math.max(bounds.y, a.y);
    const h = Math.min(bounds.y + TITLE_H, a.y + a.height) - top;
    if (w >= 100 && h >= 20 && bounds.y >= a.y) {
      const width = Math.min(bounds.width, a.width);
      const height = Math.min(bounds.height, a.height);
      if (width === bounds.width && height === bounds.height) return bounds;
      return { x: Math.max(a.x, Math.min(bounds.x, a.x + a.width - width)), y: Math.max(a.y, Math.min(bounds.y, a.y + a.height - height)), width, height };
    }
  }
  return null;
}

function pushRecent(recent, entry, now, max = 10) {
  const rest = (Array.isArray(recent) ? recent : []).filter((r) => r.address !== entry.address);
  return [{ address: entry.address, name: entry.name || "", when: now }, ...rest].slice(0, max);
}

class PrefStore {
  constructor(dir) {
    this.file = path.join(dir, "prefs.json");
    this.data = sanitize(null);
    try {
      this.data = sanitize(JSON.parse(fs.readFileSync(this.file, "utf8")));
    } catch {

    }
    this.timer = null;
  }
  get(key) {
    return this.data[key];
  }
  set(patch) {
    this.data = sanitize({ ...this.data, ...patch });
    this.scheduleSave();
    return this.data;
  }
  scheduleSave() {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.saveNow();
    }, 400);
  }
  saveNow() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch {

    }
  }
}

module.exports = { DEFAULTS, DEFAULT_HOTKEY, isValidAccelerator, isBounds, isAddress, sanitize, visibleBounds, pushRecent, PrefStore };
