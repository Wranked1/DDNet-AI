"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const EVENTS = new Set(["state", "log", "toast", "panel", "progress"]);

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("ddnet", {
  window: {
    minimize: () => invoke("win:minimize"),
    toggleMaximize: () => invoke("win:toggleMaximize"),
    close: () => invoke("win:close"),
    setMini: (on) => invoke("win:setMini", on === true),
    setOnTop: (on) => invoke("win:setOnTop", on === true),
  },
  bot: {
    togglePause: () => invoke("bot:togglePause"),
    restart: () => invoke("bot:restart"),
  },
  setup: {
    get: () => invoke("setup:get"),
    save: (form) => invoke("setup:save", form),
  },
  servers: {
    list: (force) => invoke("servers:list", force === true),

    play: (address, name, password) =>
      password === undefined
        ? invoke("servers:play", String(address), String(name ?? ""))
        : invoke("servers:play", String(address), String(name ?? ""), String(password)),
    favorite: (address, on) => invoke("servers:favorite", String(address), on === true),
  },
  log: { get: () => invoke("log:get") },
  state: () => invoke("state:get"),
  prefs: {
    get: () => invoke("prefs:get"),
    set: (patch) => invoke("prefs:set", patch),
  },
  action: (name) => invoke("app:action", String(name)),
  copy: (text) => invoke("app:copy", String(text)),
  on: (event, cb) => {
    if (!EVENTS.has(event) || typeof cb !== "function") return () => {};
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(`ev:${event}`, listener);
    return () => ipcRenderer.removeListener(`ev:${event}`, listener);
  },
});
