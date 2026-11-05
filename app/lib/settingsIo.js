"use strict";

const { withoutSecrets, SECRET_NAMES } = require("./archive.js");
const { KEYS } = require("./patch.js");

const MAX_IMPORT_BYTES = 64 * 1024;

const IMPORT_KEYS = KEYS.filter((k) => !SECRET_NAMES.test(k) && k !== "lan");

function exportText(settings) {
  const src = settings !== null && typeof settings === "object" && !Array.isArray(settings) ? settings : {};

  const { llm: _llm, ...rest } = withoutSecrets(src);
  return JSON.stringify(rest, null, 2) + "\n";
}

function parseImport(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_IMPORT_BYTES) return { ok: false, error: "Файл слишком большой для настроек" };
  let raw;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return { ok: false, error: "Это не файл настроек: не JSON" };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Это не файл настроек: ждали объект JSON" };
  const patch = {};
  const skipped = [];
  for (const k of Object.keys(raw)) {
    const v = raw[k];
    if (IMPORT_KEYS.includes(k) && (typeof v === "string" || typeof v === "boolean")) patch[k] = v;
    else skipped.push(k);
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "В файле нет настроек, которые можно загрузить" };
  return { ok: true, patch, skipped };
}

module.exports = { MAX_IMPORT_BYTES, IMPORT_KEYS, exportText, parseImport };
