(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LOGIC = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const LIMITS = { name: 15, clan: 11, skin: 23 };

  function byteLength(text) {
    let n = 0;
    for (const ch of String(text)) {
      const c = ch.codePointAt(0);
      n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    }
    return n;
  }

  function clampBytes(text, n) {
    let out = "";
    let used = 0;
    for (const ch of String(text)) {
      const b = byteLength(ch);
      if (used + b > n) break;
      out += ch;
      used += b;
    }
    return out;
  }

  const RESERVED = ["CON", "PRN", "AUX", "NUL"].concat(
    "0123456789¹²³".split("").flatMap((d) => ["COM" + d, "LPT" + d]),
  );
  function oddSpace(c) {
    return (
      c < 0x20 || c === 0x85 || c === 0xa0 || c === 0x34f || c === 0x115f || c === 0x1160 || c === 0x1680 || c === 0x180e ||
      (c >= 0x2000 && c <= 0x200f) || (c >= 0x2028 && c <= 0x202f) || (c >= 0x205f && c <= 0x2064) || (c >= 0x206a && c <= 0x206f) ||
      c === 0x2800 || c === 0x3000 || c === 0x3164 || (c >= 0xfe00 && c <= 0xfe0f) || c === 0xfeff || c === 0xffa0 || (c >= 0xfff9 && c <= 0xfffc)
    );
  }
  function isSkinName(name) {
    if (typeof name !== "string" || name === "" || byteLength(name) > LIMITS.skin) return false;
    let prevSpace = false;
    let prevPeriod = false;
    let first = true;
    for (const ch of name) {
      const c = ch.codePointAt(0);
      if (c <= 0x1f || c === 0x7f || '\\/|:*?<>"'.includes(ch)) return false;
      if (c !== 0x20 && oddSpace(c)) return false;
      if (c === 0x20) {
        if (first || prevSpace) return false;
        prevSpace = true;
        prevPeriod = false;
      } else {
        prevSpace = false;
        prevPeriod = ch === ".";
        first = false;
      }
    }
    if (prevSpace || prevPeriod) return false;
    const upper = name.toUpperCase();
    return !RESERVED.some((r) => upper === r || upper.startsWith(r + "."));
  }

  function dummyNick(name, given) {
    const nick = clampBytes(String(given || "").trim() || `${clampBytes(name, 14)}2`, 15);
    return nick === name ? `${clampBytes(name, 14)}${String(name).endsWith("2") ? "3" : "2"}` : nick;
  }

  function checkNick(raw) {
    const value = String(raw).trim();
    if (value === "") return { ok: false, error: "Ник не может быть пустым", value };
    if (byteLength(value) > LIMITS.name) return { ok: false, error: "Не длиннее {n} байт", n: LIMITS.name, value };
    return { ok: true, value };
  }
  function checkClan(raw) {
    const value = String(raw).trim();
    if (byteLength(value) > LIMITS.clan) return { ok: false, error: "Не длиннее {n} байт", n: LIMITS.clan, value };
    return { ok: true, value };
  }
  function checkSkin(raw) {
    const value = String(raw).trim();
    if (value === "") return { ok: true, value: "" };
    if (!isSkinName(value)) return { ok: false, error: "Такое имя скина DDNet не принимает", value };
    return { ok: true, value };
  }

  const THEMES = ["light", "dark", "auto"];
  function resolveTheme(pref, systemDark) {
    if (pref === "dark") return "dark";
    if (pref === "auto") return systemDark === true ? "dark" : "light";
    return "light";
  }

  const SWITCHES = [
    { key: "pathfind", on: "!pathfind on", off: "!pathfind off" },
    { key: "preinput", on: "!preinput on", off: "!preinput off" },
    { key: "humanlike", on: "!humanlike on", off: "!humanlike off" },
    { key: "dummy", on: null, off: null },
    { key: "lowCpu", on: "!low on", off: "!low off" },
    { key: "strong", on: "!strong on", off: "!strong off" },
  ];
  const SWITCH_KEYS = SWITCHES.map((s) => s.key);

  function liveLine(key, value, who) {
    const dummy = who === "dummy";
    const bang = dummy ? "!d " : "!";

    if (key === "pathfind" && !dummy && typeof value === "string") return `!pathfind ${["on", "table", "off"].includes(value) ? value : "on"}`;
    if (!dummy) {
      const sw = SWITCHES.find((x) => x.key === key);
      if (sw !== undefined) return value ? sw.on : sw.off;
    }
    if (key === "timing" && !dummy) return value ? "!timing on" : "!timing off";
    const text = value === undefined || value === null ? "" : String(value);
    if (key === "name" && !dummy) return `!nick ${text}`;
    if (key === "clan") return `${bang}clan ${text === "" ? "-" : text}`;

    if (key === "skin") return `${bang}skin ${text === "" ? (dummy ? "-" : "default") : text}`;
    return null;
  }

  function applyKind(key, ctx) {
    if (!ctx.running) return "start";
    switch (key) {
      case "skin":
      case "pathfind":
      case "preinput":
      case "humanlike":
      case "lowCpu":
      case "strong":
      case "timing":
        return "live";

      case "name":
      case "clan":
        return ctx.dummyOn ? "restart" : "live";
      case "dummyClan":
      case "dummySkin":
        return ctx.dummyOn ? "live" : "restart";
      default:
        return "restart";
    }
  }

  function parseIdentityReply(text) {
    const s = String(text || "").trim().replace(/^.*?: (?=identity: )/, "");
    let m = /^identity: in (\d+) s$/.exec(s);
    if (m !== null) return { state: "wait", seconds: Number(m[1]) };
    if (/^identity: now$/.test(s)) return { state: "now", seconds: 0 };
    if (/^identity: saved/.test(s)) return { state: "saved", seconds: 0 };
    return { state: "error", seconds: 0, text: s };
  }

  const IDENTITY_KEYS = ["name", "clan", "skin", "dummyClan", "dummySkin"];
  function patchReply(key, text) {
    return IDENTITY_KEYS.includes(key) ? parseIdentityReply(text) : { state: "now", seconds: 0 };
  }

  function sortNews(entries) {
    const list = (Array.isArray(entries) ? entries : []).filter((e) => e !== null && typeof e === "object");
    return list
      .map((e, i) => [e, i])
      .sort((a, b) => String(b[0].id || "").localeCompare(String(a[0].id || "")) || a[1] - b[1])
      .map((x) => x[0]);
  }

  function newsDate(id) {
    const m = /^(\d{4})\.(\d{2})\.(\d{2})([a-z]*)$/.exec(String(id || ""));
    return m === null ? null : { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]), letter: m[4] };
  }

  function newsLines(entries, lang, n) {
    const list = sortNews(entries);
    const e = list[0];
    if (e === undefined || e === null || typeof e !== "object") return { version: "", lines: [] };
    const pick = Array.isArray(e[lang]) && e[lang].length > 0 ? e[lang] : Array.isArray(e.ru) ? e.ru : [];
    return { version: String(e.id || "").replace(/[a-z]+$/, ""), lines: pick.filter((l) => typeof l === "string").slice(0, n) };
  }

  const SETTING_HOME = {
    name: "profile", clan: "profile", skin: "profile", dummyName: "profile", dummyClan: "profile", dummySkin: "profile",
    server: "server", password: "server",
    autostart: "launch", autostartSeconds: "launch",
    timing: "bot", brain: "bot", showTestBrains: "bot", pathfind: "bot", preinput: "bot", humanlike: "bot", dummy: "bot", lowCpu: "bot", strong: "bot",
    theme: "window", lang: "window", onTop: "window", hotkey: "window", notifications: "window", closeToTray: "window", gpu: "window", openAtLogin: "window",
    restart: "bot", openInBrowser: "bot",
    archive: "about", clips: "about", project: "about", shortcut: "about",
  };

  function autostartFromOld(prefs) {
    const p = prefs !== null && typeof prefs === "object" ? prefs : {};
    if (typeof p.autostart === "boolean") return { autostart: p.autostart, autostartSeconds: Number.isInteger(p.autostartSeconds) && p.autostartSeconds >= 0 && p.autostartSeconds <= 60 ? p.autostartSeconds : 5 };
    if (p.startScreen === false) return { autostart: true, autostartSeconds: 0 };
    return { autostart: false, autostartSeconds: 5 };
  }

  function ddKey(key, at, n) {
    if (n <= 0) return -1;
    if (key === "Home") return 0;
    if (key === "End") return n - 1;
    if (key === "PageDown") return Math.min(n - 1, Math.max(0, at) + 7);
    if (key === "PageUp") return Math.max(0, Math.max(0, at) - 7);
    if (key === "ArrowDown") return at < 0 ? 0 : (at + 1) % n;
    if (key === "ArrowUp") return at <= 0 ? n - 1 : at - 1;
    return -1;
  }

  function ddPlace(rect, vw, vh, want) {
    const gap = 4;
    const edge = 8;
    const below = vh - rect.bottom - gap - edge;
    const above = rect.top - gap - edge;
    const up = below < want.h && above > below;
    const room = Math.max(60, up ? above : below);
    const maxH = Math.min(want.h, room);
    const width = Math.min(Math.max(rect.right - rect.left, want.w), Math.max(120, vw - edge * 2));
    const left = Math.max(edge, Math.min(rect.left, vw - width - edge));
    const top = up ? Math.max(edge, rect.top - gap - maxH) : rect.bottom + gap;
    return { left, top, width, maxH, up };
  }
  function ddFilter(items, q) {
    const w = String(q).trim().toLowerCase();
    return w === "" ? items : items.filter((i) => String(i.label).toLowerCase().includes(w));
  }

  function pingAllowed(o) {
    if (o.offline === true || o.visible === false) return false;
    if (o.where !== "home" && o.where !== "servers") return false;
    return o.playing !== true || o.where === "servers";
  }

  function pingWanted(addresses, known, now, maxAge, max) {
    const out = [];
    for (const a of addresses) {
      if (out.length >= max) break;
      const k = known[a];
      const age = k === undefined ? -1 : now - k.at;
      if (out.includes(a) || (age >= 0 && age < maxAge)) continue;
      out.push(a);
    }
    return out;
  }

  function pingOnScreen(rows, list) {
    const out = [];
    if (!list || !(list.height > 0)) return out;
    for (const r of rows) {
      const b = r.box;
      if (b && b.width > 0 && b.height > 0 && b.bottom > list.top && b.top < list.bottom) out.push(r.address);
    }
    return out;
  }

  function pingClass(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "";
    return ms < 80 ? "png-g" : ms < 150 ? "png-y" : "png-r";
  }
  function pingText(ms) {
    return Number.isFinite(ms) && ms > 0 ? String(Math.round(ms)) : "\u2014";
  }

  return {
    pingAllowed, pingWanted, pingOnScreen, pingClass, pingText,
    ddKey, ddPlace, ddFilter,
    LIMITS, byteLength, clampBytes, dummyNick, isSkinName, checkNick, checkClan, checkSkin, THEMES, resolveTheme,
    SWITCHES, SWITCH_KEYS, liveLine, applyKind, parseIdentityReply, patchReply, sortNews, newsDate, newsLines, SETTING_HOME, autostartFromOld,
  };
});
