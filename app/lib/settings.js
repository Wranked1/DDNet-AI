"use strict";

const fs = require("node:fs");
const path = require("node:path");

const LOGIC = require("../ui/logic.js");

const SETTINGS_FILE = "settings.json";
const BRAINS = ["planner", "bold", "scripted"];

const LIMITS = { name: LOGIC.LIMITS.name, clan: LOGIC.LIMITS.clan, skin: LOGIC.LIMITS.skin, password: 64, server: 255 };

const SWITCH_KEYS = ["dummy", "lowCpu", "strong", "timing", "preinput", "humanlike"];

const DEFAULTS = {

  server: "auto",
  name: "AI-Tee",
  clan: "",
  skin: "cammostripes",
  password: "",
  brain: "planner",
};

function settingsPath(root) {
  return path.join(root, SETTINGS_FILE);
}

function readSettings(root) {
  try {

    const raw = JSON.parse(fs.readFileSync(settingsPath(root), "utf8").replace(/^\uFEFF/, ""));
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

function isConfigured(settings) {
  return settings !== null && typeof settings === "object" && Object.keys(settings).length > 0;
}

function parseServerAddress(text) {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (t === "" || t.length > LIMITS.server || /\s/.test(t)) return null;
  const at = t.lastIndexOf(":");
  if (at <= 0) return /^[A-Za-z0-9.\-]+$/.test(t) ? { host: t, port: 8303 } : null;
  const host = t.slice(0, at);
  const portText = t.slice(at + 1);
  if (!/^\d{1,5}$/.test(portText)) return null;
  const port = Number(portText);
  if (port < 1 || port > 65535) return null;
  if (!/^[A-Za-z0-9.\-]+$/.test(host)) return null;
  return { host, port };
}

function validateSetup(input) {
  const errors = {};
  const src = input !== null && typeof input === "object" ? input : {};
  const str = (k) => (typeof src[k] === "string" ? src[k] : "");
  const typed = str("server").trim();
  const server = /^(auto|авто)?$/i.test(typed) ? "auto" : typed;
  if (server !== "auto" && parseServerAddress(server) === null) errors.server = "Нужен адрес вида 1.2.3.4:8303";
  const name = str("name").trim();
  if (name === "") errors.name = "Ник не может быть пустым";
  else if (!LOGIC.checkNick(name).ok) errors.name = `Не длиннее ${LIMITS.name} байт`;
  const clan = str("clan").trim();
  if (!LOGIC.checkClan(clan).ok) errors.clan = `Не длиннее ${LIMITS.clan} байт`;
  const skin = str("skin").trim() || DEFAULTS.skin;
  if (!LOGIC.checkSkin(skin).ok) errors.skin = LOGIC.byteLength(skin) > LIMITS.skin ? `Не длиннее ${LIMITS.skin} байт` : "Такое имя скина DDNet не принимает";

  const password = typeof src.password === "string" ? src.password : undefined;
  if (password !== undefined && password.length > LIMITS.password) errors.password = "Слишком длинный пароль";
  const brain = str("brain") || DEFAULTS.brain;
  if (!BRAINS.includes(brain)) errors.brain = "Неизвестный мозг";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const value = { server, name, clan, skin, brain };
  if (password !== undefined) value.password = password;

  if (src.dummy !== undefined) value.dummy = src.dummy === true || src.dummy === "on" ? "on" : "off";
  if (typeof src.dummyName === "string") {
    const dn = src.dummyName.trim();
    if (LOGIC.byteLength(dn) > LIMITS.name) errors.dummyName = `Не длиннее ${LIMITS.name} байт`;
    else if (dn !== "" && dn === name) errors.dummyName = "Ник второго бота должен отличаться";
    else value.dummyName = dn;
  }

  if (typeof src.dummyClan === "string") {
    const dc = src.dummyClan.trim();
    if (LOGIC.byteLength(dc) > LIMITS.clan) errors.dummyClan = `Не длиннее ${LIMITS.clan} байт`;
    else value.dummyClan = dc;
  }
  if (typeof src.dummySkin === "string") {
    const ds = src.dummySkin.trim();
    if (!LOGIC.checkSkin(ds).ok) errors.dummySkin = LOGIC.byteLength(ds) > LIMITS.skin ? `Не длиннее ${LIMITS.skin} байт` : "Такое имя скина DDNet не принимает";
    else value.dummySkin = ds;
  }

  if (src.lowCpu !== undefined) value.lowCpu = src.lowCpu === true || src.lowCpu === "on" ? "on" : "off";

  if (src.strong !== undefined) value.strong = (src.strong === true || src.strong === "on") && value.lowCpu !== "on" ? "on" : "off";

  for (const k of ["timing", "preinput", "humanlike"]) if (src[k] !== undefined) value[k] = src[k] === true || src[k] === "on" ? "on" : "off";
  if (src.pathfind !== undefined) value.pathfind = ["on", "table", "off"].includes(src.pathfind) ? src.pathfind : src.pathfind === true ? "on" : "off";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value };
}

function writeSettings(root, value) {
  const cur = readSettings(root) ?? {};
  const out = {};
  for (const k of ["server", "name", "clan", "skin", "password", "brain"]) {
    if (value[k] !== undefined) out[k] = value[k];
    else if (cur[k] !== undefined) out[k] = cur[k];

    else out[k] = DEFAULTS[k];
  }
  for (const [k, v] of Object.entries(cur)) if (!(k in out)) out[k] = v;
  for (const k of [...SWITCH_KEYS, "dummyName", "dummyClan", "dummySkin", "pathfind"]) if (value[k] !== undefined) out[k] = value[k];
  const file = settingsPath(root);
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
  fs.renameSync(tmp, file);
  return out;
}

function sameServer(a, b) {
  if (typeof a === "string" && typeof b === "string" && a.trim() !== "" && a.trim().toLowerCase() === b.trim().toLowerCase()) return true;
  const x = parseServerAddress(a);
  const y = parseServerAddress(b);
  return x !== null && y !== null && x.host.toLowerCase() === y.host.toLowerCase() && x.port === y.port;
}

function saveSetup(root, value) {
  const cur = readSettings(root) ?? {};
  const v = { ...value };
  let clearedPassword = false;
  if (v.password === undefined && typeof cur.password === "string" && cur.password !== "" && !sameServer(cur.server, v.server)) {
    v.password = "";
    clearedPassword = true;
  }
  return { settings: writeSettings(root, v), clearedPassword };
}

function setServer(root, address, password) {
  const parsed = parseServerAddress(address);
  if (parsed === null) throw new Error("плохой адрес сервера");
  if (password !== undefined && (typeof password !== "string" || password.length > LIMITS.password)) {
    throw new Error("плохой пароль");
  }
  const cur = readSettings(root) ?? {};
  const merged = { ...DEFAULTS, ...cur, server: `${parsed.host}:${parsed.port}` };
  delete merged.password;
  if (password !== undefined) merged.password = password;
  return saveSetup(root, merged);
}

function fitIdentity(text, limit) {
  return LOGIC.byteLength(text) <= limit ? text : LOGIC.clampBytes(text.trim(), limit).trim();
}

function publicSettings(settings) {
  const s = settings ?? {};
  const pick = (k) => (typeof s[k] === "string" ? s[k] : DEFAULTS[k]);
  return {
    server: pick("server"),
    name: fitIdentity(pick("name"), LIMITS.name),
    clan: typeof s.clan === "string" ? fitIdentity(s.clan, LIMITS.clan) : "",
    skin: pick("skin"),
    brain: BRAINS.includes(s.brain) ? s.brain : DEFAULTS.brain,
    hasPassword: typeof s.password === "string" && s.password !== "",

    dummy: s.dummy === true || s.dummy === 1 || (typeof s.dummy === "string" && ["on", "true", "yes", "1"].includes(s.dummy.trim().toLowerCase())),
    dummyName: typeof s.dummyName === "string" ? fitIdentity(s.dummyName, LIMITS.name) : "",

    dummyClan: typeof s.dummyClan === "string" ? fitIdentity(s.dummyClan, LIMITS.clan) : "",
    dummySkin: typeof s.dummySkin === "string" ? s.dummySkin : "",

    lowCpu: s.lowCpu === true || s.lowCpu === 1 || (typeof s.lowCpu === "string" && ["on", "true", "yes", "1"].includes(s.lowCpu.trim().toLowerCase())),
    strong: s.strong === true || s.strong === 1 || (typeof s.strong === "string" && ["on", "true", "yes", "1"].includes(s.strong.trim().toLowerCase())),

    timing: typeof s.timing === "string" ? ["on", "true", "yes", "1"].includes(s.timing.trim().toLowerCase()) : s.timing === true,
    preinput: !(s.preinput === "off" || s.preinput === false),
    humanlike: !(s.humanlike === false || (typeof s.humanlike === "string" && ["off", "false", "no", "0"].includes(s.humanlike.trim().toLowerCase()))),
    pathfind: ["off", "table"].includes(String(s.pathfind).toLowerCase()) ? String(s.pathfind).toLowerCase() : "on",
  };
}

module.exports = {
  SETTINGS_FILE,
  BRAINS,
  LIMITS,
  SWITCH_KEYS,
  DEFAULTS,
  settingsPath,
  readSettings,
  isConfigured,
  parseServerAddress,
  validateSetup,
  writeSettings,
  sameServer,
  saveSetup,
  setServer,
  publicSettings,
  fitIdentity,
};
