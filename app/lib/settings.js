"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SETTINGS_FILE = "settings.json";
const BRAINS = ["planner", "bold", "scripted"];

const LIMITS = { name: 15, clan: 11, skin: 23, password: 64, server: 255 };

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
    const raw = JSON.parse(fs.readFileSync(settingsPath(root), "utf8"));
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
  else if ([...name].length > LIMITS.name) errors.name = `Не длиннее ${LIMITS.name} символов`;
  const clan = str("clan").trim();
  if ([...clan].length > LIMITS.clan) errors.clan = `Не длиннее ${LIMITS.clan} символов`;
  const skin = str("skin").trim() || DEFAULTS.skin;
  if ([...skin].length > LIMITS.skin) errors.skin = `Не длиннее ${LIMITS.skin} символов`;

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
    if ([...dn].length > LIMITS.name) errors.dummyName = `Не длиннее ${LIMITS.name} символов`;
    else if (dn !== "" && dn === name) errors.dummyName = "Ник второго бота должен отличаться";
    else value.dummyName = dn;
  }
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
  for (const k of ["dummy", "dummyName"]) if (value[k] !== undefined) out[k] = value[k];
  const file = settingsPath(root);
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
  fs.renameSync(tmp, file);
  return out;
}

function sameServer(a, b) {
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

function publicSettings(settings) {
  const s = settings ?? {};
  const pick = (k) => (typeof s[k] === "string" ? s[k] : DEFAULTS[k]);
  return {
    server: pick("server"),
    name: pick("name"),
    clan: typeof s.clan === "string" ? s.clan : "",
    skin: pick("skin"),
    brain: BRAINS.includes(s.brain) ? s.brain : DEFAULTS.brain,
    hasPassword: typeof s.password === "string" && s.password !== "",
    dummy: s.dummy === "on",
    dummyName: typeof s.dummyName === "string" ? s.dummyName : "",
  };
}

module.exports = {
  SETTINGS_FILE,
  BRAINS,
  LIMITS,
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
};
