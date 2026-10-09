"use strict";

const LOGIC = require("../ui/logic.js");
const settingsLib = require("./settings.js");

const KEYS = ["server", "name", "clan", "skin", "password", "brain", "dummy", "dummyName", "dummyClan", "dummySkin", "lowCpu", "strong", "timing", "preinput", "pathfind", "humanlike", "edgeSkip", "keepSide", "hallRopeGate"];

const STAND_IN = { server: "auto", name: "placeholder", clan: "", skin: "default", brain: "planner" };

function planPatch(current, patch, ctx) {
  const src = patch !== null && typeof patch === "object" ? patch : {};
  const have = KEYS.filter((k) => Object.prototype.hasOwnProperty.call(src, k));
  const form = { server: current.server, name: current.name, clan: current.clan, skin: current.skin, brain: current.brain };
  for (const k of have) form[k] = src[k];

  if (src.strong === true && src.lowCpu === undefined && current.lowCpu) form.lowCpu = false;
  if (src.lowCpu === true && src.strong === undefined && current.strong) form.strong = false;
  if (src.lowCpu === true) form.strong = false;

  if (typeof form.dummyName !== "string" && have.includes("name") && current.dummyName !== "") form.dummyName = current.dummyName;

  const touched = new Set(have);
  if (typeof form.dummyName === "string" && have.includes("name")) touched.add("dummyName");
  let res = settingsLib.validateSetup(form);

  const kept = {};
  if (!res.ok) {
    const own = Object.fromEntries(Object.entries(res.errors).filter(([k]) => touched.has(k)));
    if (Object.keys(own).length > 0) return { ok: false, errors: own };
    const loose = { ...form };
    for (const k of Object.keys(res.errors)) {
      kept[k] = form[k];
      loose[k] = STAND_IN[k];
    }
    res = settingsLib.validateSetup(loose);
    if (!res.ok) return { ok: false, errors: res.errors };
  }
  res = { ok: true, value: { ...res.value, ...kept } };

  const dummyOn = ctx.running === true && ctx.dummyRunning === true;
  const kinds = {};
  const lines = [];
  const changed = new Set(have);
  if (form.strong !== undefined && src.strong === undefined && (src.lowCpu === true)) changed.add("strong");
  if (form.lowCpu === false && src.lowCpu === undefined && src.strong === true) changed.add("lowCpu");
  for (const k of changed) {
    const was = current[k];
    const now = res.value[k] !== undefined ? res.value[k] : form[k];
    const asBool = (v) => v === true || v === "on";
    const same = typeof was === "boolean" ? was === asBool(now) : was === now;
    if (k !== "password" && same) continue;

    const kind = ctx.starting === true && ctx.running !== true ? "restart" : LOGIC.applyKind(k, { running: ctx.running === true, dummyOn });
    kinds[k] = kind;
    if (kind !== "live") continue;
    const dummyKey = k === "dummyClan" || k === "dummySkin";
    const val = k === "pathfind" ? String(now) : typeof was === "boolean" ? asBool(now) : now;
    const line = LOGIC.liveLine(dummyKey ? k.replace(/^dummy(.)/, (_m, c) => c.toLowerCase()) : k, val, dummyKey ? "dummy" : "main");
    if (line !== null) lines.push({ key: k, line });
    else kinds[k] = "restart";
  }
  return { ok: true, value: res.value, kinds, lines };
}

module.exports = { planPatch, KEYS };
