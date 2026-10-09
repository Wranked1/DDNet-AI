"use strict";

const api = window.ddnet;
const $ = (s) => document.querySelector(s);

const LANG = new URLSearchParams(location.search).get("lang") === "en" ? "en" : "ru";
const { t, tr } = I18N.makeT(I18N.EN, LANG);
const LOCALE = LANG === "en" ? "en-GB" : "ru-RU";
document.documentElement.lang = LANG;
I18N.translateDom(document.body, t, LANG);
document.documentElement.classList.remove("i18n-wait");

{
  let tip = null;
  let cur = null;
  let timer = 0;
  const hide = () => {
    clearTimeout(timer);
    cur = null;
    if (tip) tip.hidden = true;
  };

  const moveTitle = (target) => {
    const v = target.getAttribute("title") || "";
    target.removeAttribute("title");
    target.dataset.tip = v;
    if (!target.textContent.trim()) target.setAttribute("aria-label", v);
    return v;
  };
  const place = (target) => {
    const r = target.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const x = Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2));
    const y = r.bottom + 8 + h <= innerHeight - 6 ? r.bottom + 8 : Math.max(6, r.top - h - 8);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  document.addEventListener("mouseover", (e) => {
    const target = e.target instanceof Element ? e.target.closest("[title],[data-tip]") : null;
    if (target && target.hasAttribute("title")) moveTitle(target);
    if (target === cur) return;
    hide();
    if (!target || !target.dataset.tip) return;
    cur = target;
    timer = setTimeout(() => {
      if (cur !== target || !target.isConnected) return;
      if (!tip) {
        tip = el("div", "tip");
        document.body.appendChild(tip);
      }
      tip.textContent = target.dataset.tip;
      tip.hidden = false;
      place(target);

      if (target.closest("#titlebar")) setTimeout(() => cur === target && hide(), 3000);
    }, 350);
  });
  document.addEventListener("mouseout", (e) => {
    if (!e.relatedTarget) hide();
  });
  for (const ev of ["mousedown", "keydown", "wheel"]) document.addEventListener(ev, hide, true);
  addEventListener("blur", hide);

  new MutationObserver((ms) => {
    for (const m of ms) {
      const target = m.target;
      if (!target.hasAttribute("title") || !("tip" in target.dataset)) continue;
      const v = moveTitle(target);
      if (target !== cur || !tip || tip.hidden) continue;
      if (v) {
        tip.textContent = v;
        place(target);
      } else hide();
    }
  }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["title"] });
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function icon(name) {
  return el("i", `ic ic-${name}`);
}

let state = null;
let settings = null;
let configured = true;
let prefsCache = null;
let draft = {};
let tab = "home";
let frameKey = "";
let framePage = "";
let frameMini = false;
let everReady = false;
let logItems = [];
let logFilter = "";
let news = [];
let wasPlaying = false;

const swOn = (key) => (key === "pathfind" ? settings.pathfind !== "off" : settings[key] === true);
const swPatch = (key, on) => ({ [key]: key === "pathfind" ? (on ? "on" : "off") : on });

const SWITCH_TEXT = {
  pathfind: () => [t("Пасфайндер"), t("пути по карте")],
  preinput: () => [t("Предвводы"), t("ход соперника раньше")],
  humanlike: () => [t("Как человек"), t("курсор, эмоции")],
  dummy: () => [t("Второй бот"), t("дамми в тиме")],
  lowCpu: () => [t("Слабый ПК"), t("если бот лагает")],
  strong: () => [t("Сильный режим"), t("мощный ПК")],
};

const greyTee = new Image();
const greyReady = new Promise((resolve) => {
  greyTee.onload = () => resolve(true);
  greyTee.onerror = () => resolve(false);
});
greyTee.src = "../icons/tee-grey.svg";

const skinCache = new Map();
function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function skinImage(name) {
  const key = name || "default";
  if (!skinCache.has(key)) {
    skinCache.set(
      key,
      api.skins
        .get(key)
        .then((url) => (url ? loadImage(url) : null))
        .catch(() => null),
    );
  }
  return skinCache.get(key);
}

let paintToken = 0;
function paintTee(canvas, skin, s, look) {
  const box = TEE.teeBox(s);
  const dpr = window.devicePixelRatio || 1;
  const key = `${skin}|${s}|${dpr}`;
  if (canvas.dataset.painted === key) return;
  canvas.dataset.painted = key;
  canvas.width = Math.round(box.w * dpr);
  canvas.height = Math.round(box.h * dpr);
  canvas.style.width = `${box.w}px`;
  canvas.style.height = `${box.h}px`;
  const token = ++paintToken;
  canvas.dataset.token = String(token);
  Promise.all([skinImage(skin), greyReady]).then(([img]) => {
    if (canvas.dataset.token !== String(token)) return;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);
    TEE.drawTee(ctx, img, box.px, box.py, s, look || [1, 0], greyTee);
  });
}

const dropdowns = [];
function dropdown(host, o) {
  const btn = el("button", "dd-btn");
  btn.type = "button";
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  const text = el("span");
  btn.append(text, icon("chevron-down"));
  const menu = el("div", "dd-menu");
  menu.hidden = true;
  menu.tabIndex = -1;
  const find = el("input", "dd-find");
  find.type = "text";
  find.autocomplete = "off";
  find.spellcheck = false;
  find.placeholder = t("поиск");
  find.setAttribute("aria-label", t("поиск"));
  const list = el("div", "dd-list");
  list.setAttribute("role", "listbox");
  menu.append(find, list);
  host.append(btn, menu);
  let shown = [];
  let active = -1;
  let isOpen = false;
  const cur = () => o.value();
  const label = () => {
    const it = o.items().find((i) => i.value === cur());
    const v = it ? it.label : "";
    if (text.textContent !== v) text.textContent = v;
    const tip = o.title ? o.title() : "";
    if (tip) btn.title = tip;
  };
  const mark = () => {
    list.querySelectorAll(".dd-item").forEach((n, i) => n.classList.toggle("act", i === active));
    const n = list.children[active];
    if (n) {
      if (n.offsetTop < list.scrollTop) list.scrollTop = n.offsetTop;
      else if (n.offsetTop + n.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = n.offsetTop + n.offsetHeight - list.clientHeight;
    }
  };
  const render = () => {
    const all = o.items();
    find.hidden = all.length <= 8;
    shown = LOGIC.ddFilter(all, find.value);
    list.replaceChildren();
    shown.forEach((it, i) => {
      const b = el("button", `dd-item${it.value === cur() ? " on" : ""}`);
      b.type = "button";
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", String(it.value === cur()));
      b.tabIndex = -1;
      b.append(el("span", "", it.label));
      b.title = it.label;
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("mousemove", () => {
        menu.classList.remove("kb");
        if (active !== i) {
          active = i;
          mark();
        }
      });
      b.addEventListener("click", () => pick(it.value));
      list.append(b);
    });
    if (shown.length === 0) list.append(el("div", "dd-none", t("ничего не нашлось")));
  };
  const place = () => {
    const r = btn.getBoundingClientRect();
    const rows = Math.min(Math.max(shown.length, 1), 8);
    const p = LOGIC.ddPlace(r, innerWidth, innerHeight, { w: 200, h: rows * 30 + 10 + (find.hidden ? 0 : 46) });
    menu.style.left = `${p.left}px`;
    menu.style.width = `${p.width}px`;
    menu.style.maxHeight = `${p.maxH}px`;
    if (p.up) {
      menu.style.top = "auto";
      menu.style.bottom = `${innerHeight - r.top + 4}px`;
    } else {
      menu.style.bottom = "auto";
      menu.style.top = `${p.top}px`;
    }
  };
  const close = (back) => {
    if (!isOpen) return;
    isOpen = false;
    menu.hidden = true;
    btn.classList.remove("open");
    host.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
    if (back === true) btn.focus();
  };
  const open = () => {
    for (const d of dropdowns) if (d.close !== close) d.close();
    find.value = "";
    isOpen = true;
    host.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
    menu.hidden = false;
    render();
    active = Math.max(0, shown.findIndex((i) => i.value === cur()));
    place();
    mark();
    (find.hidden ? menu : find).focus();
  };
  const pick = (v) => {
    close(true);
    o.onPick(v);
    label();
  };
  btn.addEventListener("click", () => (isOpen ? close() : open()));
  btn.addEventListener("keydown", (e) => {
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !isOpen) {
      e.preventDefault();
      open();
    }
  });
  find.addEventListener("input", () => {
    render();
    active = shown.length ? 0 : -1;
    place();
    mark();
  });
  menu.addEventListener("keydown", (e) => {
    if (e.key === "Tab") return close();
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      return close(true);
    }
    if (e.key === "Enter" || (e.key === " " && find.hidden)) {
      e.preventDefault();
      if (shown[active]) pick(shown[active].value);
      return;
    }
    const to = LOGIC.ddKey(e.key, active, shown.length);
    if (to >= 0) {
      e.preventDefault();
      menu.classList.add("kb");
      active = to;
      mark();
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (isOpen && !host.contains(e.target)) close();
  }, true);
  addEventListener("resize", () => isOpen && place());
  const d = { close, label, open };
  dropdowns.push(d);
  label();
  return d;
}

$("#w-min").addEventListener("click", () => api.window.minimize());
$("#w-max").addEventListener("click", () => api.window.toggleMaximize());
$("#w-close").addEventListener("click", () => api.window.close());
$("#titlebar").addEventListener("dblclick", (e) => {
  if (e.target.closest("button, a")) return;
  api.window.toggleMaximize();
});
$("#b-pause").addEventListener("click", () => api.bot.togglePause());
$("#b-stop").addEventListener("click", () => api.bot.stop());
$("#b-mini").addEventListener("click", () => api.window.setMini(!(state && state.mini)));
$("#b-exit").addEventListener("click", () => exitPressed());
for (const b of document.querySelectorAll("#tabs .tab")) b.addEventListener("click", () => showTab(b.dataset.tab));

const TABS = ["play", "home", "servers", "clips", "settings", "log", "news"];
function showTab(name) {
  if (!TABS.includes(name)) return;
  if (name === "play" && $("#tab-play").hidden) name = "home";
  if (tab !== "home" || name !== "home") stopAuto(name === "play" ? "" : t("Запуск отменён"));
  tab = name;
  for (const v of document.querySelectorAll(".view[data-view]")) v.hidden = v.dataset.view !== name;
  if (state && state.screen === "noroot") $("#view-noroot").hidden = false;
  for (const b of document.querySelectorAll("#tabs .tab")) b.classList.toggle("on", b.dataset.tab === name);
  document.body.classList.toggle("on-play", name === "play");
  if (name === "home") void refreshHome();
  if (name === "home" || name === "servers") pingSoon();
  if (name === "servers") {
    void loadServers(false);
    setTimeout(() => $("#sv-q").focus(), 30);
  }
  if (name === "settings") void loadSettingsView();
  if (name === "clips" || name === "settings") syncFrames();
  if (name === "log") renderLog();
  if (name === "news") renderNewsAll();
}

function pillFor(s) {
  if (s.screen === "noroot") return ["off", t("папка бота не найдена")];
  if (s.screen === "setup") return ["warn", t("ждёт настройки")];
  if (s.screen === "start") return ["warn", t("ждёт старта")];
  if (s.botState !== "running") return ["warn pulse", s.botState === "waiting" ? t("перезапуск") : t("запуск бота")];
  if (s.paused) return ["warn", t("пауза · {name}", { name: s.name || t("бот") })];
  if (s.phase === "online") {
    return ["on", s.target ? t("{name} на {server} · против {target}", { name: s.name, server: s.server, target: s.target }) : t("{name} на {server}", { name: s.name, server: s.server })];
  }
  if (s.phase === "connecting") return ["warn pulse", t("подключается к {server}", { server: s.server })];
  return ["off", s.offlineReason ? t("не на сервере: {reason}", { reason: s.offlineReason }) : t("не на сервере")];
}

function render(s) {
  state = s;
  document.body.classList.toggle("mini", s.mini);

  document.body.classList.toggle("playing", s.screen === "app");
  const noroot = s.screen === "noroot";
  const playing = s.screen === "app";
  $("#tabs").hidden = noroot;
  $("#view-noroot").hidden = !noroot;
  if (noroot) for (const v of document.querySelectorAll(".view[data-view]")) if (v.dataset.view !== "noroot") v.hidden = true;
  $("#tab-play").hidden = !playing;

  $("#acts").hidden = false;
  for (const id of ["#b-pause", "#b-stop", "#b-mini"]) $(id).hidden = !playing;
  $("#b-exit").title = playing ? t("Остановить бота и вернуться на главную") : t("Закрыть программу");
  if (playing && !wasPlaying) {
    wasPlaying = true;
    showTab("play");
  } else if (!playing && wasPlaying) {
    wasPlaying = false;
    forgetGame();
    if (tab === "play") showTab("home");
  } else if (!noroot && $("#view-home").hidden && tab === "home") {
    showTab("home");
  }

  if (s.mini && playing && tab !== "play") showTab("play");
  const running = s.botState === "running";
  const pause = $("#b-pause");
  pause.disabled = !running;
  pause.classList.toggle("paused", s.paused);
  pause.querySelector(".ic").className = `ic ic-${s.paused ? "play" : "pause"}`;
  $("#b-pause-lbl").textContent = s.paused ? t("Играть") : t("Пауза");
  pause.title = `${s.paused ? t("Продолжить игру") : t("Пауза: бот встанет на месте")} (${prettyKey(s.hotkey)})`;
  $("#b-mini").title = s.mini ? t("Обычное окно") : t("Мини-режим поверх игры");
  $("#w-max-ic").className = `ic ic-${s.maximized ? "copy" : "square"}`;
  $("#w-max").title = s.maximized ? t("Восстановить") : t("Развернуть");
  $("#st-pin").classList.toggle("on", s.onTop);
  $("#st-pin").setAttribute("aria-checked", String(s.onTop));
  $("#origin-ver").textContent = shortVersion(s.botVersion);

  const showLoading = playing && ((!everReady && !(running && s.readyCount > 0)) || (Boolean(s.lastError) && !running));
  $("#screen-loading").hidden = !showLoading;

  $("#screen-loading").classList.toggle("failed", Boolean(s.lastError));
  $("#loading-err").hidden = !s.lastError;
  $("#loading-err").textContent = s.lastError ? tr(s.lastError) : "";
  $("#loading-actions").hidden = !s.lastError;
  $("#loading-title").textContent = s.lastError ? t("Бот не запускается") : t("Запускаю бота");
  $("#loading-sub").hidden = Boolean(s.lastError);

  if (running && s.port > 0) {
    const frame = $("#bot");
    const base = `http://127.0.0.1:${s.port}/`;

    const key = `${s.port}|${s.readyCount}`;
    if (key !== frameKey) {
      frameKey = key;
      framePage = `${base}?lang=${LANG}&theme=${pageTheme()}&run=${s.readyCount}`;
      loadGameFont(base);
      frameMini = s.mini;
      frame.classList.add("hidden");
      frame.src = framePage + (s.mini ? "#mini" : "#full");

      for (const f of VIEW_FRAMES) resetFrame(f);
    } else if (frameMini !== s.mini) {
      frameMini = s.mini;
      frame.src = framePage + (s.mini ? "#mini" : "#full");
    }
    everReady = true;
  }

  syncFrames();
  const banner = everReady && !running && playing && !s.lastError;
  $("#banner").hidden = !banner;
  $("#banner-text").textContent = s.botState === "waiting" ? t("Бот перезапускается...") : t("Бот запускается...");

  const off = playing && running && !s.paused && s.phase !== "online";
  $("#offline-note").hidden = !off;
  if (off) $("#offline-text").textContent = s.phase === "connecting" ? t("Подключаюсь к серверу...") : s.offlineReason ? t("Сервер не отвечает: {reason}", { reason: s.offlineReason }) : t("Сервер не отвечает, пробую снова");

  renderStatus(s);
  renderAbout(s);
  updateHome();
  updateSwitches();
  maybeAutostart();
}

function pageTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function forgetGame() {
  everReady = false;
  frameKey = "";
  const frame = $("#bot");
  frame.classList.add("hidden");
  frame.src = "about:blank";
  for (const f of VIEW_FRAMES) resetFrame(f);
  syncFrames();
}

const VIEW_FRAMES = [
  { id: "bot-clips", view: "clips", tab: "clips", empty: "clips-empty", idle: t("Записи и дуэли появятся, когда бот играет. Нажми ИГРАТЬ на главной.") },
  { id: "bot-settings", view: "settings", tab: "settings", empty: "ingame-empty", idle: t("Автоматический чат, приказы в чате, графика DDNet и настройки поиска появятся, когда бот играет. Нажми ИГРАТЬ на главной.") },
];
function resetFrame(f) {
  const frame = $(`#${f.id}`);
  frame.dataset.run = "";
  frame.classList.add("hidden");
  if (frame.getAttribute("src") !== "about:blank") frame.src = "about:blank";
}
function frameShown(f) {
  if (tab !== f.tab) return false;
  return f.tab !== "settings" || section === "ingame";
}
function syncFrames() {
  const running = state !== null && state.botState === "running" && state.port > 0 && everReady && framePage !== "";
  for (const f of VIEW_FRAMES) {
    const frame = $(`#${f.id}`);
    if (running && frameShown(f) && frame.dataset.run !== frameKey) {
      frame.dataset.run = frameKey;

      frame.src = `${framePage.replace(/([?&]theme=)[^&#]*/, `$1${pageTheme()}`)}&view=${f.view}#full`;
    }
    const empty = $(`#${f.empty}`);
    empty.hidden = running && frame.dataset.run === frameKey;

    const text = state !== null && state.screen === "app" && !running ? t("Бот запускается...") : f.idle;
    if (empty.textContent !== text) empty.textContent = text;
  }
}
for (const f of VIEW_FRAMES) {
  $(`#${f.id}`).addEventListener("load", () => {
    const frame = $(`#${f.id}`);
    if (frame.getAttribute("src") !== "about:blank") frame.classList.remove("hidden");
  });
}

function exitPressed() {
  if (state && state.screen === "app") {
    void api.bot.stop();
    return;
  }
  $("#confirm-quit").hidden = false;
  $("#confirm-quit-yes").focus();
}
function confirmQuit(yes) {
  $("#confirm-quit").hidden = true;
  if (yes) void api.action("quit");
}
$("#confirm-quit-yes").addEventListener("click", () => confirmQuit(true));
$("#confirm-quit-no").addEventListener("click", () => confirmQuit(false));
$("#confirm-quit").addEventListener("mousedown", (e) => {
  if (e.target === $("#confirm-quit")) confirmQuit(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#confirm-quit").hidden) confirmQuit(false);
});

function shortVersion(v) {
  return v && /^[0-9a-f]{7,}$/.test(v) ? v.slice(0, 7) : v || "";
}

$("#bot").addEventListener("load", () => {
  if ($("#bot").src !== "about:blank") $("#bot").classList.remove("hidden");
});

function renderStatus(s) {
  const [dotCls, text] = pillFor(s);
  $("#st-dot").className = `dot ${dotCls}`;
  const row = serverRow(s.server);
  $("#st-text").textContent = s.paused || s.phase !== "online" || !row ? text : t("в игре · {name}", { name: row.name });
  $("#st-addr").textContent = s.server || "";
  $("#st-ping").textContent = s.ping > 0 ? t("пинг {n}", { n: s.ping }) : "";
  $("#st-cpu").textContent = s.botState === "running" ? `CPU ${s.cpu}%` : "";
}

const plates = [];
let editing = null;

function dummyNickDefault() {
  return LOGIC.dummyNick(settings ? settings.name : "", "");
}

function plateFields(who) {
  if (who === "dummy") {
    return {
      nick: { key: "dummyName", get: () => settings.dummyName, shown: () => settings.dummyName || dummyNickDefault(), empty: () => !settings.dummyName, ph: () => t("пусто: ник + 2"), limit: LOGIC.LIMITS.name, check: (v) => (v.trim() === "" ? { ok: true, value: "" } : LOGIC.checkNick(v)), label: () => t("Ник второго бота") },
      clan: { key: "dummyClan", get: () => settings.dummyClan, shown: () => settings.dummyClan || settings.clan || t("нет клана"), empty: () => !settings.dummyClan, ph: () => t("пусто: как у первого"), limit: LOGIC.LIMITS.clan, check: LOGIC.checkClan, label: () => t("Клан второго бота") },
      skin: { key: "dummySkin", get: () => settings.dummySkin || settings.skin },
    };
  }
  return {
    nick: { key: "name", get: () => settings.name, shown: () => settings.name || t("введи ник"), empty: () => !settings.name, ph: () => t("введи ник"), limit: LOGIC.LIMITS.name, check: LOGIC.checkNick, label: () => t("Ник") },
    clan: { key: "clan", get: () => settings.clan, shown: () => settings.clan || t("нет клана"), empty: () => !settings.clan, ph: () => t("нет клана"), limit: LOGIC.LIMITS.clan, check: LOGIC.checkClan, label: () => t("Клан") },
    skin: { key: "skin", get: () => settings.skin },
  };
}

function makePlate(who, size, scale) {
  const root = el("div", `plate ${size}`);
  const text = el("div", "pl-text");
  const clanRow = el("div", "pl-clan");
  const nickRow = el("div", "pl-nick");
  const tee = el("div", "pl-tee");
  const canvas = el("canvas");
  const skinBtn = el("button", "pl-skin");
  skinBtn.type = "button";
  skinBtn.title = t("Скин");
  skinBtn.append(icon("shirt"));
  tee.append(canvas, skinBtn);
  text.append(clanRow, nickRow);
  root.append(text, tee);
  const plate = { root, who, update: () => {}, busy: false };

  const row = (field, host) => {
    const f = () => plateFields(who)[field];
    let shownKey = "";
    const show = () => {

      const key = `${f().shown()}|${f().empty()}`;
      if (key === shownKey && host.firstChild && host.firstChild.matches && host.firstChild.matches(".pl-btn")) return;
      shownKey = key;
      host.replaceChildren();
      const btn = el("button", "pl-btn");
      btn.type = "button";
      btn.title = field === "nick" ? t("Поменять ник") : t("Поменять клан");
      btn.append(el("span", `t${f().empty() ? " blank" : ""}`, f().shown()), icon("pencil"));
      btn.lastChild.classList.add("pen");
      btn.addEventListener("click", () => begin());
      host.append(btn);
    };
    const begin = () => {
      if (editing) editing.close();
      markHintSeen();
      const spec = f();
      const form = el("form", "pl-ed");
      const input = el("input");
      input.type = "text";
      input.value = spec.get();
      input.placeholder = spec.ph();
      input.spellcheck = false;
      input.autocomplete = "off";
      input.setAttribute("aria-label", spec.label());
      const cnt = el("span", "cnt");
      const ok = el("button", "okb", t("OK"));
      ok.type = "submit";
      ok.addEventListener("mousedown", (e) => e.preventDefault());
      const err = el("div", "pl-err");
      form.append(input, cnt, ok);
      host.replaceChildren(form, err);
      plate.busy = true;

      let open = true;
      const count = () => {
        const v = LOGIC.clampBytes(input.value, spec.limit);
        if (v !== input.value) input.value = v;
        const n = LOGIC.byteLength(input.value);
        cnt.textContent = `${n}/${spec.limit}`;
        cnt.classList.toggle("bad", n >= spec.limit);
      };
      count();
      const close = () => {
        if (!open) return;
        open = false;
        if (editing && editing.close === close) {
          editing = null;
          plate.busy = false;
        }
        show();
      };
      editing = { close };
      input.addEventListener("input", () => {
        count();
        err.textContent = "";
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      });
      input.addEventListener("blur", () => setTimeout(close, 120));
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const r = spec.check(input.value);
        if (!r.ok) {
          err.textContent = t(r.error, { n: r.n });
          return;
        }
        if (r.value === spec.get()) {
          close();
          return;
        }
        const res = await change({ [spec.key]: r.value });
        if (res && res.ok === false) {
          err.textContent = firstError(res);
          return;
        }
        close();
      });
      input.focus();
      input.select();
    };
    return { show, begin };
  };
  const clan = row("clan", clanRow);
  const nick = row("nick", nickRow);
  skinBtn.addEventListener("click", () => {
    markHintSeen();
    openSkinPicker(skinBtn, plateFields(who).skin.get(), (name) => change({ [plateFields(who).skin.key]: name }));
  });

  plate.update = () => {
    if (settings === null) return;
    root.classList.toggle("need", who === "main" && !settings.name);
    if (!plate.busy) {
      clan.show();
      nick.show();
    }
    paintTee(canvas, plateFields(who).skin.get(), scale, [1, 0]);
  };
  plate.update();
  plates.push(plate);
  return plate;
}

function firstError(res) {
  const v = res && res.errors ? Object.values(res.errors)[0] : res && typeof res.error === "string" ? res.error : "";
  return typeof v === "string" && v !== "" ? tr(ipcText(v)) : t("не вышло");
}

function ipcText(text) {
  return String(text).replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, "");
}

let hintTimer = 0;
function showHint() {
  if (!prefsCache || prefsCache.hintShown) return;
  $("#hint").hidden = false;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(markHintSeen, 25000);
}
function markHintSeen() {
  clearTimeout(hintTimer);
  if ($("#hint").hidden && prefsCache && prefsCache.hintShown) return;
  $("#hint").hidden = true;
  if (prefsCache && !prefsCache.hintShown) {
    prefsCache.hintShown = true;
    void api.prefs.set({ hintShown: true });
  }
}

let skinList = null;
let pickerAnchor = null;
let pickerCb = null;
let pickerCurrent = "";
let pickerObserver = null;
async function loadSkinList() {
  if (skinList === null) {
    try {
      skinList = await api.skins.list();
    } catch {
      skinList = { names: [], found: false };
    }
  }
  return skinList;
}

function closeSkinPicker() {
  $("#skinpick").hidden = true;
  pickerAnchor = null;
  pickerCb = null;
  if (pickerObserver) pickerObserver.disconnect();
  pickerObserver = null;
}

async function openSkinPicker(anchor, current, cb) {
  const box = $("#skinpick");

  if (!box.hidden && pickerAnchor === anchor) {
    closeSkinPicker();
    return;
  }
  pickerAnchor = anchor;
  pickerCb = cb;
  pickerCurrent = current;
  $("#skin-q").value = "";
  box.hidden = false;
  placePicker(anchor);
  await loadSkinList();
  renderSkinGrid();
  $("#skin-q").focus();
}

function placePicker(anchor) {
  const box = $("#skinpick");
  const r = anchor.getBoundingClientRect();
  const w = box.offsetWidth;
  const h = Math.min(460, innerHeight * 0.8);
  box.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
  box.style.top = `${r.bottom + 8 + h <= innerHeight - 8 ? r.bottom + 8 : Math.max(8, Math.min(r.top - 8, innerHeight - 8) - h)}px`;
}

function renderSkinGrid() {
  const list = skinList || { names: [], found: false };
  const q = $("#skin-q").value.trim().toLowerCase();
  const grid = $("#skin-grid");
  grid.replaceChildren();
  if (pickerObserver) pickerObserver.disconnect();
  pickerObserver = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        pickerObserver.unobserve(e.target);
        paintTee(e.target.querySelector("canvas"), e.target.dataset.skin, 0.5, [1, 0]);
      }
    },
    { root: grid, rootMargin: "120px" },
  );
  const hits = list.names.filter((n) => q === "" || n.toLowerCase().includes(q));

  const typed = $("#skin-q").value.trim();
  if (typed !== "" && LOGIC.isSkinName(typed) && !list.names.includes(typed)) {
    const use = el("button", "skin-cell use");
    use.type = "button";
    use.dataset.skin = typed;
    use.title = typed;
    use.append(el("canvas"), el("span", "", t("взять «{name}»", { name: typed })));
    use.addEventListener("click", () => {
      const cb = pickerCb;
      closeSkinPicker();
      if (cb) void cb(typed);
    });
    grid.append(use);
    paintTee(use.querySelector("canvas"), typed, 0.5, [1, 0]);
  }
  const SHOWN = 240;
  const show = hits.slice(0, SHOWN);

  const at = show.indexOf(pickerCurrent);
  if (at > 0) show.unshift(show.splice(at, 1)[0]);

  const EAGER = 30;
  let drawn = grid.childElementCount;
  for (const name of show) {
    const cell = el("button", `skin-cell${name === pickerCurrent ? " on" : ""}`);
    cell.type = "button";
    cell.dataset.skin = name;
    cell.title = name;
    cell.append(el("canvas"), el("span", "", name));
    cell.addEventListener("click", () => {
      const cb = pickerCb;
      closeSkinPicker();
      if (cb) void cb(name);
    });
    grid.append(cell);
    if (drawn++ < EAGER) paintTee(cell.querySelector("canvas"), name, 0.5, [1, 0]);
    else pickerObserver.observe(cell);
  }
  const foot = $("#skin-foot");
  if (!list.found) foot.textContent = t("Скины берутся из твоей установки DDNet, а её не нашлось: ти пока серые. Папку DDNet можно указать в «Настройки» > «В игре».");
  else if (hits.length === 0) foot.textContent = typed !== "" && LOGIC.isSkinName(typed) ? "" : t("Такого скина нет");
  else if (hits.length > SHOWN) foot.textContent = t("Показано {n} из {total}: уточни поиск", { n: SHOWN, total: hits.length });
  else foot.textContent = "";
}
$("#skin-q").addEventListener("input", () => renderSkinGrid());
document.addEventListener("mousedown", (e) => {
  const box = $("#skinpick");
  if (box.hidden || box.contains(e.target) || e.target.closest(".pl-skin, .sk")) return;
  closeSkinPicker();
});

const switchBoxes = [];
const SWITCH_ORDER = LOGIC.SWITCH_KEYS;

function buildSwitches(box, size) {
  const rows = {};
  box.replaceChildren();
  let panel = null;
  let plate = null;
  for (const key of SWITCH_ORDER) {
    const wrap = el("div", "row-wrap");
    const row = el("div", "row");
    const nm = el("div", "nm");
    const [label, hint] = SWITCH_TEXT[key]();
    nm.append(document.createTextNode(label), el("small", "", hint));
    const sw = el("button", "sw");
    sw.type = "button";
    sw.setAttribute("role", "switch");
    sw.setAttribute("aria-label", label);
    sw.addEventListener("click", () => {
      if (settings === null) return;
      void change(swPatch(key, !swOn(key)));
    });
    row.append(nm, sw);
    wrap.append(row);
    if (key === "dummy") {

      panel = el("div", "dummy-panel");
      const inner = el("div", "dp-in");
      const card = el("div", "dp-card");
      plate = makePlate("dummy", "xs", size === "tight" ? 0.55 : 0.7);
      card.append(plate.root);
      inner.append(card);
      panel.append(inner);
      wrap.append(panel);
    }
    box.append(wrap);
    rows[key] = { sw };
  }
  switchBoxes.push({ box, rows, panel, plate });
}

function updateSwitches() {
  if (settings === null) return;
  for (const sb of switchBoxes) {
    for (const key of SWITCH_ORDER) {
      const on = swOn(key);
      sb.rows[key].sw.classList.toggle("on", on);
      sb.rows[key].sw.setAttribute("aria-checked", String(on));
    }
    sb.panel.classList.toggle("on", settings.dummy === true);
    sb.panel.inert = settings.dummy !== true;
    if (sb.plate) sb.plate.update();
  }
  for (const p of plates) if (p.who === "main") p.update();
  updateSettingsFields();
}

const same = (a, b) => a === b;
function mergeLocal(cur, patch) {
  const next = { ...cur, ...patch };
  if (patch.strong === true) next.lowCpu = false;
  if (patch.lowCpu === true) next.strong = false;
  if (patch.password !== undefined) next.hasPassword = patch.password !== "";
  return next;
}

async function change(patch, opts = {}) {
  const before = settings;
  settings = mergeLocal(settings, patch);
  const firstRun = state !== null && state.screen === "setup";
  if (firstRun) Object.assign(draft, patch);
  updateAll();
  if (firstRun) return { ok: true, draft: true };
  let res;
  try {
    res = await api.settings.patch(patch);
  } catch (err) {
    res = { ok: false, errors: { x: ipcText(err.message) } };
  }
  if (!res || !res.ok) {
    settings = before;
    updateAll();
    toast({ text: firstError(res), kind: "error" });
    return res;
  }
  if (res.settings) settings = { ...settings, ...res.settings };
  if (opts.quiet !== true) report(res);
  updateAll();
  return res;
}

function report(res) {
  const kinds = Object.values(res.kinds || {});
  if (kinds.includes("restart")) toast({ text: t("Применится при следующем запуске"), kind: "info" });
  for (const r of res.replies || []) {
    if (r.state === "wait") toast({ text: t("применится через {n} с", { n: r.seconds }), kind: "info" });
    else if (r.state === "error") toast({ text: tr(r.text || t("не вышло")), kind: "error" });
  }
}

function updateAll() {
  updateHome();
  updateSwitches();
  renderSettingsProfile();
}

let homeServers = { rows: [], ok: false, loaded: false };
let homeGen = 0;
let favorites = [];
let recent = [];
let homeTimer = 0;

const nickOk = () => settings !== null && LOGIC.checkNick(settings.name || "").ok;
const serverRow = (addr) => homeServers.rows.find((r) => r.address === addr) || null;

async function refreshHome() {
  clearTimeout(homeTimer);
  try {
    const [res, prefs] = await Promise.all([api.servers.list(false), api.prefs.get()]);
    prefsCache = { ...(prefsCache || {}), ...prefs };
    favorites = prefs.favorites;
    recent = prefs.recent;
    homeServers = { rows: res.ok ? res.rows : [], ok: res.ok, loaded: true };
  } catch {
    homeServers = { rows: [], ok: false, loaded: true };
  }
  homeGen++;
  updateHome();
  if (state) renderStatus(state);
  if (tab === "home" && state && state.screen !== "noroot") homeTimer = setTimeout(refreshHome, 30000);
}

function currentAddress() {
  return settings && settings.server !== "auto" ? settings.server : "auto";
}

function fillCard() {
  const card = $("#srv-card");
  card.replaceChildren();
  const addr = currentAddress();
  const row = serverRow(addr);
  const offline = addr !== "auto" && homeServers.loaded && homeServers.ok && !row;
  card.classList.toggle("off", offline);
  card.append(icon(offline ? "wifi-off" : "server"));
  const main = el("div", "grow");
  const other = el("button", "btn", t("Другой сервер"));
  other.type = "button";
  other.addEventListener("click", () => showTab("servers"));
  if (addr === "auto") {
    main.append(el("b", "", t("Сервер выберется сам")));
    main.append(el("div", "m", t("самый живой блок-сервер на момент запуска")));
  } else {
    const label = row ? row.name : (recent.find((r) => r.address === addr) || {}).name || addr;
    main.append(el("b", "", label));
    const m = el("div", "m");
    if (row) {
      const ping = state && state.screen === "app" && state.server === addr && state.ping > 0 ? t("{n} мс", { n: state.ping }) : "";
      if (ping) m.append(el("span", "mono p", ping), document.createTextNode(" · "));
      m.append(el("span", "mono", `${row.clients}/${row.maxClients}`), document.createTextNode(` · ${row.gameType || "?"} · `), el("span", "mono", addr));
    } else if (offline) {
      m.append(el("span", "w", t("не отвечает: возможно, выключен")), document.createTextNode(" · "), el("span", "mono", addr));
    } else {
      m.append(el("span", "mono", addr));
      if (homeServers.loaded && !homeServers.ok) m.append(document.createTextNode(` · ${t("список серверов недоступен")}`));
    }
    main.append(m);
  }
  card.append(main, other);
}

function fillTable() {
  const box = $("#srv-table");
  box.replaceChildren();
  const hd = el("div", "r hd");
  hd.append(el("span"), el("span", "", t("Избранные и недавние")), el("span", "", t("Карта")), el("span", "mono", t("Игроки")), el("span", "mono png", t("Пинг")), el("span", "mono reg", t("Регион")));
  box.append(hd);
  const addr = currentAddress();
  const seen = new Set();
  const rows = [];
  const named = (a) => {
    const live = serverRow(a);
    const old = recent.find((r) => r.address === a);
    return { address: a, name: live ? live.name : old && old.name ? old.name : a, map: live ? live.map : "", players: live ? `${live.clients}/${live.maxClients}` : "", region: live ? regionOf(live.location) : "", gone: homeServers.loaded && homeServers.ok && !live };
  };
  for (const a of favorites) if (!seen.has(a)) (seen.add(a), rows.push({ ...named(a), fav: true }));
  for (const r of recent) if (!seen.has(r.address)) (seen.add(r.address), rows.push({ ...named(r.address), fav: false }));
  if (addr !== "auto" && !seen.has(addr)) rows.unshift({ ...named(addr), fav: false });
  for (const r of rows.slice(0, 5)) {
    const b = el("button", `r${r.address === addr ? " on" : ""}${r.gone ? " gone" : ""}`);
    b.type = "button";
    const st = el("span", "st");
    if (r.fav) st.append(icon("star-fill"));
    const nm = el("span", "nm", r.name);
    const mp = el("span", "mp", r.gone ? t("не отвечает") : r.map);
    b.append(st, nm, mp, el("span", "mono", r.players), pingCell(r.address), el("span", "mono reg", r.region));
    b.addEventListener("click", () => void pickHomeServer(r.address, r.name));
    box.append(b);
  }
  const auto = el("button", `r${addr === "auto" ? " on" : ""}`);
  auto.type = "button";
  auto.append(el("span"), el("span", "nm", t("сервер сам")), el("span", "mp", t("самый живой блок")), el("span"), el("span"), el("span", "reg"));
  auto.addEventListener("click", () => void pickHomeServer("auto", ""));
  box.append(auto);
  pingSoon();
}

async function pickHomeServer(address, name) {
  if (state && state.screen === "app") {

    try {
      if (address === "auto") {
        const res = await change({ server: "auto" }, { quiet: true });
        if (res && res.ok !== false) await api.bot.restart();
      } else await api.servers.play(address, name);
    } catch (err) {
      toast({ text: ipcText(err.message), kind: "error" });
    }
    return;
  }
  if (address === "auto") {
    await change({ server: "auto" });
    return;
  }
  if (state && state.screen === "setup") {
    await change({ server: address });
    return;
  }
  const res = await api.servers.select(address, name);
  if (res && res.ok) {
    await reloadSettings();
    await refreshHome();
  }
}

let cardKey = "";
let tableKey = "";
function updateHome() {
  if (settings === null || state === null) return;
  for (const p of plates) if (p.who === "main") p.update();
  const both = [currentAddress(), homeGen, homeServers.loaded, homeServers.ok, favorites, recent];

  const ping = state.screen === "app" && state.server === currentAddress() ? state.ping : 0;
  const ck = JSON.stringify([...both, state.screen, state.server, ping]);
  if (ck !== cardKey) {
    cardKey = ck;
    fillCard();
  }
  const tk = JSON.stringify(both);
  if (tk !== tableKey) {
    tableKey = tk;
    fillTable();
  }
  updatePlay();
}

let playBusy = false;
function updatePlay() {
  const btn = $("#play");
  if (state === null || settings === null) return;
  const playing = state.screen === "app";
  const ok = nickOk();

  btn.disabled = playBusy || (!playing && !ok);
  $("#play-lbl").textContent = playing ? t("К ИГРЕ") : t("ИГРАТЬ");
  if (autoTimer === null) $("#play-note").replaceChildren(document.createTextNode(!playing && !ok ? t("Введи ник, и можно играть") : cancelNote));
}

async function play() {
  stopAuto("");
  if (state && state.screen === "app") {
    showTab("play");
    return;
  }
  if (!nickOk() || playBusy) return;
  playBusy = true;
  $("#play").disabled = true;
  try {
    const res = state.screen === "setup" ? await api.setup.save(fullForm()) : await api.start.play();
    if (res && res.ok === false) toast({ text: firstError(res), kind: "error" });
  } catch (err) {
    toast({ text: ipcText(err.message), kind: "error" });
  } finally {
    playBusy = false;
    updatePlay();
  }
}
$("#play").addEventListener("click", () => void play());

function fullForm() {
  const f = {
    server: settings.server === "auto" ? "" : settings.server,
    name: settings.name,
    clan: settings.clan,
    skin: settings.skin,
    brain: settings.brain,
    dummy: settings.dummy ? "on" : "off",
    dummyName: settings.dummyName,
    dummyClan: settings.dummyClan,
    dummySkin: settings.dummySkin,
    lowCpu: settings.lowCpu ? "on" : "off",
    strong: settings.strong ? "on" : "off",
    timing: settings.timing ? "on" : "off",
    preinput: settings.preinput ? "on" : "off",
    humanlike: settings.humanlike ? "on" : "off",
    pathfind: settings.pathfind,
  };
  f.password = draft.password !== undefined ? draft.password : "";
  return f;
}

let autoTimer = null;
let autoLeft = 0;
let autoDone = false;
let cancelNote = "";
function maybeAutostart() {
  if (autoDone || !prefsCache || !prefsCache.autostart || state === null || settings === null) return;

  if (state.screen !== "start" || state.launchSpent === true || !nickOk()) return;
  autoDone = true;
  autoLeft = prefsCache.autostartSeconds;
  if (autoLeft <= 0) {
    void play();
    return;
  }
  tickAuto(true);
  autoTimer = setInterval(() => tickAuto(false), 1000);
}
function tickAuto(first) {
  if (!first) autoLeft--;
  if (autoLeft <= 0) {
    stopAuto("");
    void play();
    return;
  }
  const note = $("#play-note");
  note.textContent = t("Запуск через {n} с", { n: autoLeft });
  const stay = el("button", "linkbtn", t("отмена"));
  stay.type = "button";
  stay.addEventListener("click", () => stopAuto(t("Запуск отменён")));
  note.append(stay);
}
function stopAuto(text) {
  const was = autoTimer !== null;
  if (was) clearInterval(autoTimer);
  autoTimer = null;
  cancelNote = was ? text : "";
  if (was || text === "") $("#play-note").textContent = was ? text : "";
}
for (const ev of ["pointerdown", "keydown"]) {
  $("#view-home").addEventListener(ev, (e) => {
    if (autoTimer !== null && !(e.target.closest && e.target.closest("#play"))) stopAuto(t("Запуск отменён"));
  });
}

function richLine(line, lead) {
  const li = el("li");
  let rest = line;
  if (lead) {
    const m = /^([^:`]{3,40}):\s+([\s\S]*)$/.exec(line);
    if (m) {
      li.append(el("b", "", `${m[1]}: `));
      rest = m[2];
    }
  }
  const span = el("span", lead ? "clamp" : "");
  while (li.firstChild) span.append(li.firstChild);
  rest.split("`").forEach((part, i) => {
    if (part === "") return;
    span.append(i % 2 === 1 ? el("code", "", part) : document.createTextNode(part));
  });
  li.append(span);
  return li;
}

async function loadNews() {
  try {
    news = LOGIC.sortNews((await api.news.get()).entries);
  } catch {
    news = [];
  }
  const n = LOGIC.newsLines(news, LANG, 3);
  const box = $("#news-box");
  box.hidden = n.lines.length === 0;
  $("#news-h").textContent = t("Новое в {version}", { version: n.version });
  $("#news-list").replaceChildren(...n.lines.map((l) => richLine(l, true)));
  if (tab === "news") renderNewsAll();
}
$("#news-more").addEventListener("click", () => showTab("news"));

function newsDateText(id) {
  const d = LOGIC.newsDate(id);
  return d === null ? String(id || "") : new Date(d.y, d.m - 1, d.d).toLocaleDateString(LOCALE, { day: "numeric", month: "long", year: "numeric" });
}

function renderNewsAll() {
  const box = $("#news-all");
  box.replaceChildren();
  if (news.length === 0) {
    box.append(el("div", "empty", t("Записей нет")));
    return;
  }
  news.forEach((e, i) => {
    const card = el("div", `ne${i === 0 ? " first" : ""}`);
    const head = el("div", "ne-h");
    head.append(el("span", "ne-date", newsDateText(e.id)), el("span", "ne-ver", String(e.id || "")));
    card.append(head);
    const ul = el("ul");
    const lines = Array.isArray(e[LANG]) && e[LANG].length ? e[LANG] : Array.isArray(e.ru) ? e.ru : [];
    for (const l of lines) if (typeof l === "string") ul.append(richLine(l, false));
    card.append(ul);
    box.append(card);
  });
}

$("#loading-log").addEventListener("click", () => showTab("log"));
$("#loading-restart").addEventListener("click", () => api.bot.restart());
$("#noroot-pick").addEventListener("click", () => api.action("chooseRoot"));

function renderTail() {
  $("#loading-tail").textContent = logItems.slice(-7).map((l) => l.text).join("\n");
}

const svFilters = { hideEmpty: true, hideFull: false, hideLocked: true, onlyFavorites: false };
let svRows = [];
let svFavs = new Set();
let svRecent = [];
let svSelected = null;
let svLoading = false;
let svPassFor = "";

for (const c of document.querySelectorAll(".chip[data-f]")) {
  c.addEventListener("click", () => {
    svFilters[c.dataset.f] = !svFilters[c.dataset.f];
    c.classList.toggle("on", svFilters[c.dataset.f]);
    renderServers();
  });
}
$("#sv-q").addEventListener("input", () => renderServers());
$("#sv-refresh").addEventListener("click", () => loadServers(true));

async function loadServers(force) {
  if (svLoading) return;
  svLoading = true;
  $("#sv-refresh").querySelector(".ic").classList.add("spin");
  if (svRows.length === 0) showEmpty(t("Загружаю список с мастер-сервера DDNet..."));
  try {
    const [res, prefs] = await Promise.all([api.servers.list(force), api.prefs.get()]);
    svFavs = new Set(prefs.favorites);
    svRecent = prefs.recent;
    if (!res.ok) {
      svRows = [];
      showEmpty(tr(res.error));
      $("#sv-count").textContent = "";
    } else {
      svRows = res.rows;
      renderServers();
    }
    renderRecent();
  } catch (err) {
    showEmpty(t("Не загрузилось: {err}", { err: err.message }));
  } finally {
    svLoading = false;
    $("#sv-refresh").querySelector(".ic").classList.remove("spin");
  }
}

function showEmpty(text) {
  $("#sv-rows").textContent = "";
  $("#sv-empty").hidden = false;
  $("#sv-empty").textContent = text;
}

function matches(r, q, opts) {
  if (opts.onlyFavorites && !svFavs.has(r.address)) return false;
  if (opts.hideEmpty && r.clients === 0) return false;
  if (opts.hideFull && r.maxClients > 0 && r.clients >= r.maxClients) return false;
  if (opts.hideLocked && r.passworded) return false;
  if (q === "") return true;
  return (
    r.name.toLowerCase().includes(q) ||
    r.map.toLowerCase().includes(q) ||
    r.gameType.toLowerCase().includes(q) ||
    r.address.includes(q) ||
    r.names.some((n) => n.toLowerCase().includes(q))
  );
}

function renderServers() {
  const q = $("#sv-q").value.trim().toLowerCase();

  const rows = svRows.filter((r) => matches(r, q, svFilters)).sort((a, b) => Number(svFavs.has(b.address)) - Number(svFavs.has(a.address)));
  const players = svRows.reduce((n, r) => n + r.players, 0);
  $("#sv-count").textContent = svRows.length ? t("{n} из {total} · {players} игроков онлайн", { n: rows.length, total: svRows.length, players }) : "";
  const body = $("#sv-rows");
  body.textContent = "";
  if (rows.length === 0) {
    showEmpty(svRows.length ? t("Ничего не нашлось. Попробуй снять фильтры.") : t("Список пуст."));
    return;
  }
  $("#sv-empty").hidden = true;
  const current = state && state.server;
  const frag = document.createDocumentFragment();
  for (const r of rows.slice(0, 600)) {
    const tr = el("tr");
    if (svSelected && svSelected.address === r.address) tr.classList.add("sel");
    if (current === r.address || (settings && settings.server === r.address)) tr.classList.add("cur");
    const fav = el("td", "c-fav");
    const star = el("button", `star${svFavs.has(r.address) ? " on" : ""}`);
    star.type = "button";
    star.title = svFavs.has(r.address) ? t("Убрать из избранного") : t("В избранное");
    star.append(icon(svFavs.has(r.address) ? "star-fill" : "star"));
    star.addEventListener("click", async (e) => {
      e.stopPropagation();
      svFavs = new Set(await api.servers.favorite(r.address, !svFavs.has(r.address)));
      renderServers();
    });
    fav.append(star);
    const name = el("td");
    const nm = el("div", "sv-name");
    if (r.passworded) nm.append(icon("lock"));
    nm.append(el("span", "", r.name));
    name.append(nm);
    name.title = `${r.name}\n${r.gameType} · ${r.address}`;
    const map = el("td", "", r.map);
    map.title = r.map;
    const num = el("td", "c-num");
    const bar = el("span", "bar-full");
    const fill = el("i");
    fill.style.width = `${r.maxClients ? Math.min(100, (r.clients / r.maxClients) * 100) : 0}%`;
    bar.append(fill);
    const cell = el("span", "num-cell");
    cell.append(bar, el("span", "num-txt", `${r.clients}/${r.maxClients}`));
    num.append(cell);
    const png = el("td", "c-png");
    png.append(pingCell(r.address));
    const reg = el("td", "c-reg", regionOf(r.location));
    tr.append(fav, name, map, num, png, reg);
    tr.addEventListener("click", () => selectServer(r));
    tr.addEventListener("dblclick", () => playServer(r));
    frag.append(tr);
  }
  body.append(frag);
  pingSoon();
}

function regionOf(loc) {
  const m = /^([a-z]{2,3})(?::([a-z]{2}))?/i.exec(loc || "");
  if (!m) return "";
  return m[2] ? `${m[1].toUpperCase()} ${m[2].toUpperCase()}` : m[1].toUpperCase();
}

const PING_AGE = 30000;
const pings = {};
let pingBusy = false;

let pingAgain = false;
let pingDebounce = 0;

function pingCell(address) {
  const c = el("span", "mono png");
  c.dataset.ping = address;
  paintPing(c);
  return c;
}

function paintPing(c) {
  const k = pings[c.dataset.ping];
  const ms = k ? k.ms : null;
  c.textContent = k ? LOGIC.pingText(ms) : "";
  c.className = `mono png ${LOGIC.pingClass(ms)}`.trim();
  c.title = ms ? t("{n} мс", { n: ms }) : k ? t("не ответил") : "";
}

function paintPings() {
  for (const c of document.querySelectorAll("[data-ping]")) paintPing(c);
}

function pingRowsOnScreen() {
  const list = tab === "home" ? $("#srv-table") : tab === "servers" ? document.querySelector(".sv-table-wrap") : null;
  if (list === null) return [];
  const rows = [...list.querySelectorAll("[data-ping]")].map((c) => ({ address: c.dataset.ping, box: c.parentElement.getBoundingClientRect() }));
  return LOGIC.pingOnScreen(rows, list.getBoundingClientRect());
}

function pingSoon() {
  clearTimeout(pingDebounce);
  pingDebounce = setTimeout(() => void runPing(), 300);
}

async function runPing() {
  if (tab !== "home" && tab !== "servers") return;
  if (pingBusy) {
    pingAgain = true;
    return;
  }
  const playing = state !== null && state.screen === "app";
  if (!LOGIC.pingAllowed({ playing, where: tab, visible: !document.hidden })) return;
  const want = LOGIC.pingWanted(pingRowsOnScreen(), pings, Date.now(), PING_AGE, 40);
  if (want.length === 0) return;
  pingBusy = true;
  try {
    const got = await api.servers.ping(want, tab);
    const at = Date.now();

    for (const a of want) pings[a] = { at, ms: Object.prototype.hasOwnProperty.call(got, a) ? got[a] : null };
    paintPings();
  } catch {

  } finally {
    pingBusy = false;
    if (pingAgain) {
      pingAgain = false;
      pingSoon();
    }
  }
}

setInterval(() => void runPing(), PING_AGE);
document.querySelector(".sv-table-wrap").addEventListener("scroll", pingSoon, { passive: true });

function selectServer(r) {
  svSelected = r;
  $("#sv-detail").hidden = false;
  $("#sv-d-name").textContent = r.name;
  $("#sv-d-meta").textContent = `${r.gameType || "?"} · ${r.map || "?"} · ${r.address} · ${r.clients}/${r.maxClients}${r.passworded ? ` · ${t("с паролем")}` : ""}`;
  const passBox = $("#sv-passbox");
  if (svPassFor !== r.address) {
    $("#sv-pass").value = "";
    svPassFor = r.address;
  }
  passBox.hidden = !r.passworded;
  $("#sv-pass").classList.remove("bad");

  $("#sv-pick").hidden = Boolean(state && state.screen === "app");
  const q = $("#sv-q").value.trim().toLowerCase();
  const box = $("#sv-d-players");
  box.textContent = "";

  const hit = (n) => q !== "" && n.toLowerCase().includes(q);
  const names = [...r.names.filter(hit), ...r.names.filter((n) => !hit(n))];
  const SHOW = 14;
  for (const n of names.slice(0, SHOW)) box.append(el("span", hit(n) ? "hit" : "", n));
  if (names.length > SHOW) box.append(el("span", "more", t("и ещё {n}", { n: names.length - SHOW })));
  if (names.length === 0) box.append(el("span", "", t("никого")));
  for (const tr of document.querySelectorAll("#sv-rows tr")) tr.classList.remove("sel");
  renderServers();
}

function serverPassword(r) {
  if (!r.passworded) return { ok: true, password: undefined };
  const password = $("#sv-pass").value;
  if (password === "") {
    $("#sv-pass").classList.add("bad");
    $("#sv-pass").focus();
    toast({ text: t("У этого сервера пароль: впиши его"), kind: "warn" });
    return { ok: false };
  }
  return { ok: true, password };
}

async function playServer(r) {
  const pw = serverPassword(r);
  if (!pw.ok) return;
  const res = await api.servers.play(r.address, r.name, pw.password);
  if (res && res.setupOnly) {
    await change({ server: r.address });
    if (pw.password !== undefined) await change({ password: pw.password });
  }
  showTab(state && state.screen === "app" ? "play" : "home");
}

async function pickServer(r) {
  const pw = serverPassword(r);
  if (!pw.ok) return;
  const res = await api.servers.select(r.address, r.name, pw.password);
  if (res && res.setupOnly) {
    await change({ server: r.address });
    if (pw.password !== undefined) await change({ password: pw.password });
  } else await reloadSettings();
  showTab("home");
}
$("#sv-play").addEventListener("click", () => svSelected && playServer(svSelected));
$("#sv-pick").addEventListener("click", () => svSelected && pickServer(svSelected));
$("#sv-copy").addEventListener("click", async () => {
  if (!svSelected) return;
  await api.copy(svSelected.address);
  toast({ text: t("Скопировано: {addr}", { addr: svSelected.address }), kind: "ok" });
});
$("#sv-manual").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("#sv-addr").value.trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/.test(v)) {
    $("#sv-addr").classList.add("bad");
    toast({ text: t("Нужен адрес вида 1.2.3.4:8303"), kind: "warn" });
    return;
  }
  $("#sv-addr").classList.remove("bad");
  void playServer({ address: v, name: "", passworded: false });
});

function renderRecent() {
  const box = $("#sv-recent");
  box.textContent = "";
  if (!svRecent.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.append(el("span", "muted small", t("Недавние:")));
  for (const r of svRecent.slice(0, 6)) {
    const c = el("button", "chip");
    c.type = "button";
    c.title = r.address;
    c.append(icon("clock"), el("span", "", r.name || r.address));
    c.addEventListener("click", () => {
      const row = svRows.find((x) => x.address === r.address) || { address: r.address, name: r.name, gameType: "", map: "", clients: 0, maxClients: 0, names: [], passworded: false, location: "" };
      selectServer(row);
    });
    box.append(c);
  }
}

const SECTIONS = ["profile", "server", "launch", "bot", "ingame", "window", "about"];
let section = "profile";
let recordingHotkey = false;

function showSection(name) {
  if (!SECTIONS.includes(name)) return;
  section = name;
  for (const b of document.querySelectorAll("#sec-nav button")) b.classList.toggle("on", b.dataset.sec === name);
  for (const p of document.querySelectorAll(".pane[data-pane]")) p.hidden = p.dataset.pane !== name;
  $("#view-settings").classList.toggle("ig", name === "ingame");
  syncFrames();
}
for (const b of document.querySelectorAll("#sec-nav button")) b.addEventListener("click", () => showSection(b.dataset.sec));

async function reloadSettings() {
  const data = await api.setup.get();
  configured = data.configured;
  settings = { ...data.settings };

  if (!configured) settings = { ...settings, name: "", ...draft };
  updateAll();
}

async function loadSettingsView() {
  const [prefs] = await Promise.all([api.prefs.get(), reloadSettings()]);
  prefsCache = { ...(prefsCache || {}), ...prefs };
  updateSettingsFields();
  renderAbout(state);
}

function bytesField(input, countEl, limit) {
  input.addEventListener("input", () => {
    const v = LOGIC.clampBytes(input.value, limit);
    if (v !== input.value) input.value = v;
    const n = LOGIC.byteLength(input.value);
    countEl.textContent = `${n}/${limit}`;
    countEl.classList.toggle("bad", n >= limit);
  });
}

function bindText(id, key, check, empty) {
  const input = $(`#f-${id}`);
  const err = $(`#f-${id}-e`);
  input.addEventListener("change", async () => {
    err.textContent = "";
    input.classList.remove("bad");
    const r = check(input.value);
    if (!r.ok) {
      err.textContent = t(r.error, { n: r.n });
      input.classList.add("bad");
      return;
    }
    if (r.value === (settings[key] || "") && !(empty && r.value === "")) return;
    const res = await change({ [key]: r.value });
    if (res && res.ok === false) {
      err.textContent = firstError(res);
      input.classList.add("bad");
    }
  });
}

bytesField($("#f-name"), $("#f-name-n"), LOGIC.LIMITS.name);
bytesField($("#f-clan"), $("#f-clan-n"), LOGIC.LIMITS.clan);
bytesField($("#f-dummyName"), $("#f-dummyName-n"), LOGIC.LIMITS.name);
bindText("name", "name", LOGIC.checkNick);
bindText("clan", "clan", LOGIC.checkClan);
bindText("dummyName", "dummyName", (v) => (v.trim() === "" ? { ok: true, value: "" } : LOGIC.checkNick(v)));

$("#f-server").addEventListener("change", async () => {
  const input = $("#f-server");
  const err = $("#f-server-e");
  err.textContent = "";
  const v = input.value.trim();
  const ok = v === "" || /^(auto|авто)$/i.test(v) || /^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(v);
  if (!ok) {
    err.textContent = t("Нужен адрес вида 1.2.3.4:8303");
    return;
  }
  const res = await change({ server: v === "" || /^(auto|авто)$/i.test(v) ? "auto" : v });
  if (res && res.ok === false) err.textContent = firstError(res);
});
$("#f-pick").addEventListener("click", () => showTab("servers"));
$("#f-password").addEventListener("change", async () => {
  const v = $("#f-password").value;
  if (v === "") return;
  const res = await change({ password: v });
  if (res && res.ok !== false) {
    $("#f-password").value = "";
    toast({ text: t("Пароль сохранён"), kind: "ok" });
  }
});
$("#f-pass-clear").addEventListener("click", async () => {
  await change({ password: "" });
  toast({ text: t("Пароль стёрт"), kind: "ok" });
});

function bindPref(id, key) {
  $(`#${id}`).addEventListener("click", async () => {
    const on = !(prefsCache && prefsCache[key] === true);
    prefsCache = { ...(prefsCache || {}), [key]: on };
    updateSettingsFields();
    const res = await api.prefs.set({ [key]: on });
    if (!res.ok) toast({ text: tr(res.error), kind: "error" });
    return res;
  });
}
bindPref("f-autostart", "autostart");
$("#f-autostartSeconds").addEventListener("change", async () => {
  const n = Math.max(0, Math.min(60, Math.round(Number($("#f-autostartSeconds").value) || 0)));
  $("#f-autostartSeconds").value = String(n);
  prefsCache = { ...(prefsCache || {}), autostartSeconds: n };
  await api.prefs.set({ autostartSeconds: n });
});

for (const [id, by] of [["#f-autostartSeconds-dn", -1], ["#f-autostartSeconds-up", 1]]) {
  $(id).addEventListener("click", () => {
    const f = $("#f-autostartSeconds");
    f.value = String(Math.max(0, Math.min(60, (Number(f.value) || 0) + by)));
    f.dispatchEvent(new Event("change"));
  });
}
$("#f-timing").addEventListener("click", () => {
  if (settings) void change({ timing: !settings.timing });
});

for (const key of ["edgeSkip", "keepSide", "hallRopeGate"]) {
  $(`#f-${key}`).addEventListener("click", () => {
    if (settings) void change({ [key]: !settings[key] });
  });
}

for (const b of document.querySelectorAll("#f-pfmode button")) {
  b.addEventListener("click", () => {
    if (settings && settings.pathfind !== b.dataset.v) void change({ pathfind: b.dataset.v });
  });
}
for (const r of document.querySelectorAll("input[name=brain]")) {
  r.addEventListener("change", () => {
    if (r.checked && settings && settings.brain !== r.value) void change({ brain: r.value });
  });
}

async function setPref(patch) {
  const res = await api.prefs.set(patch);
  if (!res.ok) toast({ text: tr(res.error), kind: "error" });
  return res;
}
for (const [id, key] of [["st-notify", "notifications"], ["st-tray", "closeToTray"], ["st-login", "openAtLogin"]]) {
  $(`#${id}`).addEventListener("click", async () => {
    const on = !(prefsCache && prefsCache[key] === true);
    prefsCache = { ...(prefsCache || {}), [key]: on };
    updateSettingsFields();
    await setPref({ [key]: on });
  });
}
$("#st-gpu").addEventListener("click", async () => {
  const on = !(prefsCache && prefsCache.gpu !== false);
  prefsCache = { ...(prefsCache || {}), gpu: on };
  updateSettingsFields();
  const res = await setPref({ gpu: on });
  if (res.ok) toast({ text: t("Применится после перезапуска окна"), kind: "info" });
});
$("#st-pin").addEventListener("click", () => api.window.setOnTop(!(state && state.onTop)));

const langDd = dropdown($("#st-lang"), {
  items: () => [{ value: "auto", label: t("Как в системе") }, { value: "ru", label: "Русский" }, { value: "en", label: "English" }],
  value: () => (prefsCache && prefsCache.lang) || "auto",
  onPick: (v) => setPref({ lang: v }),
  title: () => t("Язык"),
});
for (const b of document.querySelectorAll("#f-theme button")) {
  b.addEventListener("click", async () => {
    prefsCache = { ...(prefsCache || {}), theme: b.dataset.v };
    window.setTheme(b.dataset.v);
    updateSettingsFields();
    await setPref({ theme: b.dataset.v });
  });
}
$("#st-restart").addEventListener("click", () => api.bot.restart());
$("#st-browser").addEventListener("click", () => api.action("openInBrowser"));
$("#st-archive").addEventListener("click", () => api.action("collectArchive"));
$("#st-clips").addEventListener("click", () => api.action("openClips"));
$("#st-project").addEventListener("click", () => api.action("openProject"));
$("#st-shortcut").addEventListener("click", () => api.action("desktopShortcut"));

function setSwitch(id, on) {
  const b = $(`#${id}`);
  b.classList.toggle("on", on);
  b.setAttribute("aria-checked", String(on));
}

function updateSettingsFields() {
  if (settings === null) return;
  const set = (id, v) => {
    const input = $(id);
    if (document.activeElement !== input) input.value = v;
  };
  set("#f-name", settings.name || "");
  set("#f-clan", settings.clan || "");
  set("#f-dummyName", settings.dummyName || "");
  set("#f-server", settings.server === "auto" ? "" : settings.server);
  for (const [id, key, limit] of [["f-name", "name", LOGIC.LIMITS.name], ["f-clan", "clan", LOGIC.LIMITS.clan], ["f-dummyName", "dummyName", LOGIC.LIMITS.name]]) {
    if (document.activeElement === $(`#${id}`)) continue;
    const n = LOGIC.byteLength(settings[key] || "");
    $(`#${id}-n`).textContent = `${n}/${limit}`;
  }
  $("#f-pass-hint").textContent = settings.hasPassword ? t("сохранён") : "";
  $("#f-pass-clear").hidden = !settings.hasPassword;
  $("#f-password").placeholder = settings.hasPassword ? t("сохранён, пусто = не менять") : t("не нужен");
  setSwitch("f-timing", settings.timing === true);
  for (const key of ["edgeSkip", "keepSide", "hallRopeGate"]) setSwitch(`f-${key}`, settings[key] === true);
  for (const b of document.querySelectorAll("#f-pfmode button")) b.classList.toggle("on", b.dataset.v === (settings.pathfind || "on"));
  for (const r of document.querySelectorAll("input[name=brain]")) r.checked = r.value === settings.brain;
  if (!prefsCache) return;
  setSwitch("f-autostart", prefsCache.autostart === true);
  $("#f-autostart-row").hidden = prefsCache.autostart !== true;
  set("#f-autostartSeconds", String(prefsCache.autostartSeconds));
  setSwitch("st-notify", prefsCache.notifications === true);
  setSwitch("st-tray", prefsCache.closeToTray === true);
  $("#st-tray").disabled = prefsCache.trayAvailable === false;
  setSwitch("st-gpu", prefsCache.gpu !== false);
  setSwitch("st-login", prefsCache.openAtLogin === true);
  $("#st-login-row").hidden = prefsCache.loginSupported === false;
  langDd.label();
  for (const b of document.querySelectorAll("#f-theme button")) b.classList.toggle("on", b.dataset.v === (prefsCache.theme || "light"));
  if (!recordingHotkey) $("#st-hotkey").textContent = prettyKey(prefsCache.hotkey || (state && state.hotkey));
  $("#st-hotkey-err").textContent = state && state.hotkeyError ? tr(state.hotkeyError) : "";
}

let profileSkin = null;
function renderSettingsProfile() {
  if (settings === null) return;
  const box = $("#f-skins");
  const cur = settings.skin;
  const names = skinList ? skinList.names : [];
  const popular = ["cammostripes", "default", "coala", "pinky", "bluestripe", "brownbear", "limekitty", "saddo", "warpaint"];
  const pick = [cur, ...popular.filter((n) => n !== cur && (names.length === 0 || names.includes(n)))].slice(0, 5);
  const key = `${pick.join("|")}|${cur}`;
  if (profileSkin !== key) {
    profileSkin = key;
    box.replaceChildren();
    for (const name of pick) {
      const b = el("button", `sk${name === cur ? " on" : ""}`);
      b.type = "button";
      b.title = name;
      const c = el("canvas");
      b.append(c);
      b.addEventListener("click", () => change({ skin: name }));
      box.append(b);
      paintTee(c, name, 0.5, [1, 0]);
    }
    const more = el("button", "sk", t("все…"));
    more.type = "button";
    more.addEventListener("click", () => openSkinPicker(more, settings.skin, (name) => change({ skin: name })));
    box.append(more);
  }
  const prev = $("#prev");
  if (prev.childElementCount === 0) {
    const tx = el("div", "pv-t");
    tx.append(el("i"), el("b"), el("small", "", t("так тебя увидят в игре")));
    const tee = el("div", "pv-tee");
    tee.append(el("canvas"));
    prev.append(tx, tee);
  }
  prev.querySelector("i").textContent = settings.clan || "";
  prev.querySelector("i").hidden = !settings.clan;
  prev.querySelector("b").textContent = settings.name || t("введи ник");
  paintTee(prev.querySelector("canvas"), settings.skin, 1.3, [1, 0]);
}

function stopRecording() {
  if (!recordingHotkey) return;
  recordingHotkey = false;
  $("#st-hotkey").classList.remove("rec");
  $("#st-hotkey").textContent = prettyKey(prefsCache ? prefsCache.hotkey : state && state.hotkey);
}
function prettyKey(accel) {
  return String(accel || "").replace("CommandOrControl", "Ctrl").replace("CmdOrCtrl", "Ctrl").split("+").join(" + ");
}
$("#st-hotkey").addEventListener("click", () => {
  recordingHotkey = true;
  $("#st-hotkey").classList.add("rec");
  $("#st-hotkey").textContent = t("нажми сочетание...");
  $("#st-hotkey").focus();
});
$("#st-hotkey").addEventListener("blur", () => stopRecording());
document.addEventListener("keydown", async (e) => {
  if (e.key === "Escape" && !$("#skinpick").hidden) closeSkinPicker();
  if (!recordingHotkey) return;
  if (document.activeElement !== $("#st-hotkey")) {
    stopRecording();
    return;
  }
  e.preventDefault();
  if (e.key === "Escape") {
    stopRecording();
    return;
  }
  const key = keyName(e);
  if (key === null) return;
  const mods = [];
  if (e.ctrlKey) mods.push("CommandOrControl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");
  const accel = [...mods, key].join("+");
  stopRecording();
  const res = await setPref({ hotkey: accel });
  $("#st-hotkey-err").textContent = res.ok ? "" : tr(res.error);
  await loadSettingsView();
  if (res.ok) toast({ text: t("Пауза теперь на {key}", { key: prettyKey(accel) }), kind: "ok" });
});

function keyName(e) {
  const c = e.code;
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (/^F([1-9]|1\d|2[0-4])$/.test(c)) return c;
  if (/^Numpad\d$/.test(c)) return `num${c.slice(6)}`;
  const map = { Space: "Space", Insert: "Insert", Delete: "Delete", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Pause: "Pause",
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
    Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backslash: "\\" };
  return map[c] || null;
}

let fontFrom = "";
function loadGameFont(base) {
  if (fontFrom === base || typeof FontFace !== "function") return;
  fontFrom = base;
  try {
    const face = new FontFace("DejaVu Sans DDNet", `url(${base}assets/fonts/DejaVuSans.ttf)`);
    face.load().then((f) => document.fonts.add(f)).catch(() => {});
  } catch {

  }
}

let aboutKey = "";
function renderAbout(s) {
  if (!s) return;

  const key = JSON.stringify([s.root, s.platform, s.appVersion, s.botVersion, s.runtime, s.port]);
  if (key === aboutKey) return;
  aboutKey = key;
  $("#st-root").textContent = s.root || "";
  $("#st-root").title = s.root || "";
  $("#st-shortcut").hidden = s.platform !== "win32";
  const box = $("#st-about");
  box.textContent = "";
  const add = (k, v, wrap = false) => {
    const dd = el("dd", wrap ? "wrap" : "", v || "-");
    dd.title = v || "";
    box.append(el("dt", "", k), dd);
  };
  add(t("Приложение"), s.appVersion);
  add(t("Версия бота"), shortVersion(s.botVersion) || t("неизвестна"));
  add(t("Чем запущен"), s.runtime ? tr(s.runtime.label) : "");
  add(t("Страница бота"), s.port ? `127.0.0.1:${s.port}` : "");
  add(t("Папка"), s.root || "");
  add(t("Графика"), t("DDNet / Teeworlds (data: CC-BY-SA 3.0; скины, шрифты и ассеты под своими лицензиями). В бота не входит: окно берёт её из твоей установки DDNet, а недостающие скины качает с skins.ddnet.org в runs/skincache (выключается в «Настройки» > «В игре»). Код отрисовки частично по исходникам DDNet (zlib)."), true);
  add(t("Шрифты"), t("Unbounded, Golos Text и JetBrains Mono под SIL Open Font License, тексты лицензий лежат в ui/fonts."), true);
}

$("#ld-q").addEventListener("input", (e) => {
  logFilter = e.target.value.toLowerCase();
  renderLog();
});
$("#ld-copy").addEventListener("click", async () => {
  await api.copy(logItems.map((l) => `[${l.s}] ${l.text}`).join("\n").slice(-9000));
  toast({ text: t("Лог скопирован"), kind: "ok" });
});

function logRow(l) {
  const d = el("div", l.s === "err" ? "err" : l.s === "app" ? "app" : "");
  const at = new Date(l.t);
  d.append(el("time", "", at.toLocaleTimeString(LOCALE)), document.createTextNode(l.text));
  return d;
}

function renderLog() {
  const body = $("#ld-body");
  body.textContent = "";
  const frag = document.createDocumentFragment();
  for (const l of logItems) if (!logFilter || l.text.toLowerCase().includes(logFilter)) frag.append(logRow(l));
  body.append(frag);
  body.scrollTop = body.scrollHeight;
}

function appendLog(l) {
  logItems.push(l);
  if (logItems.length > 4000) logItems.splice(0, logItems.length - 4000);
  if (tab === "log" && (!logFilter || l.text.toLowerCase().includes(logFilter))) {
    const body = $("#ld-body");
    const stick = body.scrollTop + body.clientHeight >= body.scrollHeight - 30;
    body.append(logRow(l));
    while (body.childElementCount > 4000) body.firstChild.remove();
    if (stick) body.scrollTop = body.scrollHeight;
  }
  if (!$("#screen-loading").hidden) renderTail();
}

let progressToast = null;
function toast({ text, kind = "info" }) {
  const box = el("div", `toast ${kind}`);
  box.append(icon(kind === "ok" ? "check" : kind === "error" || kind === "warn" ? "circle-alert" : "bell"), el("span", "", text));
  $("#toasts").append(box);
  setTimeout(() => {
    box.classList.add("out");
    setTimeout(() => box.remove(), 300);
  }, kind === "error" ? 7000 : 3800);
}

function progress({ done, total }) {
  if (progressToast === null) {
    progressToast = el("div", "toast info");
    const bar = el("div", "progress");
    bar.append(el("i"));
    progressToast.append(icon("archive"), el("span", "", t("Архив")), bar);
    $("#toasts").append(progressToast);
  }
  progressToast.querySelector(".progress i").style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`;
  progressToast.querySelector("span").textContent = t("Архив: {done} из {total}", { done, total });
  if (done >= total) {
    const t = progressToast;
    progressToast = null;
    setTimeout(() => t.remove(), 600);
  }
}

api.on("state", (s) => {
  const before = state === null ? null : state.screen;
  const stampBefore = state === null ? null : state.settingsStamp;
  render(s);

  if ((before !== null && before !== s.screen) || (stampBefore !== null && stampBefore !== s.settingsStamp)) void reloadSettings();
});
api.on("log", appendLog);
api.on("toast", toast);
api.on("progress", progress);

(async () => {
  const [s, prefs] = await Promise.all([api.state(), api.prefs.get()]);
  prefsCache = prefs;
  favorites = prefs.favorites;
  recent = prefs.recent;
  await reloadSettings();
  loadSkinList().then(() => updateAll());
  buildSwitches($("#sw-home"), "home");
  buildSwitches($("#sw-set"), "set");
  plateMain();
  logItems = await api.log.get();

  render(state ?? s);
  void loadNews();
  void refreshHome();
  renderTail();
  showHint();

  const [h, sec] = location.hash.replace("#", "").split("/");
  if (TABS.includes(h)) showTab(h);
  if (h === "settings" && SECTIONS.includes(sec)) showSection(sec);
})();

function plateMain() {
  $("#plate-main").append(makePlate("main", "lg", 2.1).root);
}

window.__debug = {
  tab: (name) => showTab(name),
  firstRun: async (v) => {
    await change({ name: v.name, clan: v.clan || "", skin: v.skin || "cammostripes", server: v.server || "auto" });
    await play();
  },
};
