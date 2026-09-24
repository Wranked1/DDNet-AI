"use strict";

const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  protocol,
  screen,
  session,
  shell,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const { PrefStore, isValidAccelerator, isAddress, visibleBounds, pushRecent, touchHistory, DEFAULT_HOTKEY } = require("./lib/prefs.js");
const { BotSupervisor, request, portFree } = require("./lib/botProcess.js");
const { RingBuffer, PhaseWatcher } = require("./lib/supervisor.js");
const { findProjectRoot, isProjectRoot, nodeCandidates, pickNode } = require("./lib/runtime.js");
const settingsLib = require("./lib/settings.js");
const { MASTERS, parseServerList } = require("./lib/servers.js");
const { planArchive, archiveName, freeArchivePath } = require("./lib/archive.js");
const { writeZip } = require("./lib/zip.js");
const I18N = require("./ui/i18n.js");

const APP_DIR = __dirname;
const SHELL_ORIGIN = "app://shell";
const SHELL_URL = `${SHELL_ORIGIN}/ui/index.html`;
const BG = "#2b2f3a";
const NORMAL_MIN = { width: 760, height: 500 };
const MINI_DEFAULT = { width: 440, height: 300 };
const APP_ID = "ddnet-ai.app";

const argv = process.argv.slice(1);
const hasFlag = (f) => argv.includes(f);
const argValue = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};

const OFFLINE = process.env.DDNET_AI_APP_OFFLINE === "1" || hasFlag("--offline");

const SHOT_DIR = process.env.DDNET_AI_SHOTS || argValue("--screenshot-dir");
const START_HIDDEN = hasFlag("--hidden");

const PLAY_NOW = hasFlag("--play");

const START_COUNTDOWN_S = 10;

if (process.env.DDNET_AI_USER_DATA) app.setPath("userData", path.resolve(process.env.DDNET_AI_USER_DATA));
app.setName("DDNet AI");

app.commandLine.appendSwitch("disable-features", "FluentOverlayScrollbar,FluentScrollbar,OverlayScrollbar");
if (process.platform === "win32") app.setAppUserModelId(APP_ID);

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  main();
}

function main() {
  let prefs = null;
  let win = null;
  let tray = null;
  let quitting = false;
  let root = null;
  let runtime = null;
  let bot = null;
  let mini = false;
  let onTop = false;
  let normalBounds = null;
  let wasMaximized = false;
  let lastStatus = null;
  let botVersion = "";
  let readyCount = 0;
  let pollTimer = null;
  let hotkeyError = "";
  let lastError = "";
  let pendingUpdateSha = null;
  let serverCache = null;
  let trayKey = "";

  let modeBeforePause = null;
  let pendingMaximize = false;
  let crashReloads = [];
  let lastFocusAt = 0;
  const logBuf = new RingBuffer(4000);
  const phase = new PhaseWatcher();

  let lang = "ru";
  let T = I18N.makeT(I18N.EN, lang);
  const t = (s, p) => T.t(s, p);
  const tr = (s) => T.tr(s);
  function systemLanguages() {
    const out = [];
    for (const get of [() => app.getPreferredSystemLanguages(), () => [app.getSystemLocale()], () => [app.getLocale()]]) {
      try {
        out.push(...get());
      } catch {

      }
    }
    return out;
  }
  function applyLang() {
    lang = I18N.resolveLang(prefs.get("lang"), systemLanguages());
    T = I18N.makeT(I18N.EN, lang);
    if (runtime !== null) runtime.env.DDNET_AI_LANG = lang;
  }
  const shellUrl = () => `${SHELL_URL}?lang=${lang}`;

  const isPaused = () => lastStatus !== null && lastStatus.mode === "hold" && lastStatus.acting === false;

  function screenName() {
    if (root === null) return "noroot";
    if (!settingsLib.isConfigured(settingsLib.readSettings(root))) return "setup";
    if (startGate) return "start";
    return "app";
  }

  let startGate = false;

  function historyNow() {
    const s = settingsLib.publicSettings(root === null ? null : settingsLib.readSettings(root));

    const known = (prefs.get("recent") || []).find((r) => r.address === s.server);
    return { server: s.server || "auto", label: known ? known.name : "", name: s.name, clan: s.clan, skin: s.skin, brain: s.brain };
  }

  function recordHistory(opts) {
    try {
      prefs.set({ history: touchHistory(prefs.get("history"), historyNow(), Date.now(), opts) });
    } catch {

    }
  }

  const HISTORY_TICK_MS = 30_000;
  setInterval(() => {
    if (prefs && bot !== null && bot.state === "running") recordHistory({ playedMs: HISTORY_TICK_MS });
  }, HISTORY_TICK_MS).unref?.();

  async function releaseStart() {
    if (!startGate) return;
    startGate = false;
    pushState();
    if (!(await checkForeignBot())) return;
    startBot();
  }

  function getState() {
    const st = lastStatus;
    return {
      screen: screenName(),
      root,
      botState: bot === null ? "idle" : bot.state,
      port: bot === null ? 0 : bot.port,
      readyCount,
      phase: st ? st.phase : "offline",
      paused: isPaused(),
      server: st ? st.server : "",
      name: st ? st.name : "",
      target: st ? st.targetName : null,
      brain: st ? st.brain : "",
      mode: st ? st.mode : "",
      offlineReason: st ? st.offlineReason : "",
      mini,
      onTop,
      maximized: win !== null && win.isMaximized(),
      runtime: runtime === null ? null : { kind: runtime.kind, label: runtime.label, path: runtime.command },
      botVersion,
      appVersion: app.getVersion(),
      hotkey: prefs.get("hotkey"),
      hotkeyError,
      lastError,
      debug: Boolean(SHOT_DIR),
      platform: process.platform,
      lang,
    };
  }

  function send(event, payload) {
    if (win !== null && !win.isDestroyed()) win.webContents.send(`ev:${event}`, payload);
  }

  const pushState = () => {
    send("state", getState());
    updateTray();
    updateTaskbar();
  };

  let taskbarKey = "";
  function updateTaskbar() {
    if (win === null || win.isDestroyed()) return;
    const running = bot !== null && bot.state === "running";
    const key = JSON.stringify([statusText(), running, isPaused()]);
    if (key === taskbarKey) return;
    taskbarKey = key;
    win.setTitle(`DDNet AI: ${statusText()}`);
    if (process.platform !== "win32") return;
    const paused = isPaused();
    win.setThumbarButtons(
      running
        ? [
            {
              tooltip: paused ? t("Продолжить игру") : t("Пауза"),
              icon: nativeImage.createFromPath(path.join(APP_DIR, "icons", paused ? "thumb-play.png" : "thumb-pause.png")),
              click: () => void togglePause(),
            },
          ]
        : [],
    );
  }

  const toast = (text, kind = "info") => send("toast", { text, kind });

  function addLog(stream, text) {
    const item = { t: Date.now(), s: stream, text };
    logBuf.push(item);
    send("log", item);
    if (SHOT_DIR && stream === "app") console.log(`[app] ${text}`);
  }

  function notify(title, body) {
    if (!prefs.get("notifications")) return;
    if (!Notification.isSupported()) {

      if (tray !== null && process.platform === "win32") {
        try {
          tray.displayBalloon({ title, content: body, iconType: "info" });
        } catch {

        }
      }
      return;
    }
    const n = new Notification({ title, body, icon: path.join(APP_DIR, "icons", "app-64.png"), silent: false });
    n.on("click", () => showWindow());
    n.show();
  }

  function ensureStartMenuShortcut() {
    if (process.platform !== "win32") return;
    try {
      const lnk = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "DDNet AI.lnk");
      const want = {
        target: process.execPath,
        args: app.isPackaged ? "" : `"${app.getAppPath()}"`,
        cwd: path.dirname(process.execPath),

        icon: path.join(APP_DIR, "icons", "app.ico"),
        iconIndex: 0,
        description: t("DDNet AI: окно бота"),
        appUserModelId: APP_ID,
      };
      if (fs.existsSync(lnk)) {
        try {
          const cur = shell.readShortcutLink(lnk);
          if (cur.target === want.target && cur.args === want.args && cur.appUserModelId === APP_ID) return;
        } catch {

        }
      }
      if (!shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? "replace" : "create", want)) addLog("app", t("ярлык в меню Пуск не создался: уведомления могут не показываться"));
    } catch (err) {
      addLog("app", t("ярлык в меню Пуск: {err}", { err: err.message }));
    }
  }

  function resolveRuntime() {
    const env = { ...process.env, DDNET_AI_LANG: lang };
    delete env.ELECTRON_RUN_AS_NODE;
    const embedded = () => ({
      kind: "embedded",
      command: process.execPath,
      prefixArgs: [],
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
      label: t("встроенный Node.js {v}", { v: process.versions.node }),
    });
    if (process.env.DDNET_AI_RUNTIME === "embedded") return embedded();
    const probe = (p) => {
      try {
        if (!fs.statSync(p).isFile()) return null;
        const r = spawnSync(p, ["-v"], { encoding: "utf8", timeout: 5000, windowsHide: true, env });
        return r.status === 0 ? r.stdout : null;
      } catch {
        return null;
      }
    };
    const pick = pickNode(nodeCandidates(process.env, process.platform), probe);
    if (pick.kind === "system") {
      return { kind: "system", command: pick.path, prefixArgs: [], env, label: `Node.js ${pick.version}` };
    }
    for (const old of pick.tooOld) addLog("app", t("Node.js {v} в {path} слишком старый, беру встроенный", { v: old.version, path: old.path }));
    return embedded();
  }

  function resolveRoot() {
    const exists = (p) => fs.existsSync(p);
    const override = process.env.DDNET_AI_ROOT || argValue("--root");
    if (override) {
      const r = path.resolve(override);
      return isProjectRoot(r, exists) ? r : null;
    }
    const found = findProjectRoot([app.getAppPath(), path.dirname(process.execPath), process.cwd()], exists);
    if (found !== null) return found;
    const saved = prefs.get("projectRoot");
    return saved && isProjectRoot(saved, exists) ? saved : null;
  }

  const childFile = () => path.join(app.getPath("userData"), "bot-child.json");
  function rememberChild(port) {
    try {
      fs.writeFileSync(childFile(), JSON.stringify({ port }));
    } catch {

    }
  }
  function forgetChild() {
    fs.rmSync(childFile(), { force: true });
  }
  async function stopOrphan() {
    let port = 0;
    try {
      port = JSON.parse(fs.readFileSync(childFile(), "utf8")).port;
    } catch {
      return;
    }
    forgetChild();
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return;
    try {
      const body = await request(port, "GET", "/api", undefined, 1000);
      if (!body || typeof body !== "object" || !body.status || typeof body.status.phase !== "string") return;
      addLog("app", t("остался бот от прошлого запуска на порту {port}, прошу его выйти", { port }));
      await request(port, "POST", "/cmd", { line: "!quit" }, 1000).catch(() => {});
      const end = Date.now() + 6000;
      do await new Promise((r) => setTimeout(r, 300));
      while (Date.now() < end && !(await portFree(port)));
    } catch {

    }
  }

  async function checkForeignBot() {
    if (root === null || screenName() !== "app") return true;
    const port = prefs.get("webPort");
    if (await portFree(port)) return true;
    let body = null;
    try {
      body = await request(port, "GET", "/api", undefined, 1500);
    } catch {
      return true;
    }
    if (!body || typeof body !== "object" || !body.status || typeof body.status.phase !== "string") return true;
    const who = typeof body.status.name === "string" && body.status.name ? `"${body.status.name}"` : t("бот");
    addLog("app", t("на порту {port} уже работает другой бот ({who}), скорее всего из run-gui.vbs", { port, who }));
    const r = await dialog.showMessageBox(win !== null && win.isVisible() ? win : undefined, {
      type: "warning",
      title: "DDNet AI",
      message: t("Уже работает другой бот ({who}) на порту {port}.", { who, port }),
      detail: t("Скорее всего его запустил run-gui.vbs: он скрытый и перезапускает бота сам каждые 5 секунд. Если запустить ещё одного, на сервере будут два ти с этого компьютера."),
      buttons: [t("Остановить тот и играть отсюда"), t("Запустить второго"), t("Выйти")],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (r.response === 2) {
      quit();
      return false;
    }
    if (r.response === 1) return true;
    await stopForeignBot(port);
    return true;
  }

  async function stopForeignBot(port) {
    if (process.platform === "win32") {

      const ps =
        "Get-CimInstance Win32_Process -Filter \"Name='wscript.exe'\" | " +
        "Where-Object { $_.CommandLine -like '*run-gui.vbs*' } | " +
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force }";
      await new Promise((resolve) => {
        try {
          const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, stdio: "ignore" });
          p.once("error", resolve);
          p.once("close", resolve);
        } catch {
          resolve();
        }
      });
    }
    await request(port, "POST", "/cmd", { line: "!quit" }, 1500).catch(() => {});
    const end = Date.now() + 8000;
    while (Date.now() < end && !(await portFree(port))) await new Promise((r) => setTimeout(r, 300));
    addLog("app", (await portFree(port)) ? t("тот бот остановлен") : t("порт {port} всё ещё занят: запускаю на другом", { port }));
  }

  function startBot() {
    if (root === null || bot !== null) return;
    if (screenName() !== "app") return;
    runtime = resolveRuntime();
    addLog("app", t("папка бота: {root}", { root }));
    addLog("app", OFFLINE ? t("запускаю: {what} (без сети)", { what: runtime.label }) : t("запускаю: {what}", { what: runtime.label }));
    bot = new BotSupervisor({ root, runtime, preferredPort: prefs.get("webPort"), offline: OFFLINE });
    bot.on("line", ({ stream, text }) => addLog(stream, stream === "app" ? tr(text) : text));
    bot.on("spawn", ({ pid, port }) => {
      addLog("app", t("бот запущен, pid {pid}, порт {port}", { pid, port }));
      pushState();
    });
    bot.on("state", () => pushState());
    bot.on("ready", ({ port }) => {
      readyCount++;
      rememberChild(port);
      lastError = "";
      addLog("app", t("страница бота готова: {url}", { url: `http://127.0.0.1:${port}` }));
      recordHistory({ session: true });
      if (pendingUpdateSha !== null) {
        notify(t("Обновление установлено"), t("Бот перезапущен на версии {sha}.", { sha: pendingUpdateSha.slice(0, 7) }));
        pendingUpdateSha = null;
      }
      startPolling();
      pushState();
    });
    bot.on("updated", ({ sha }) => {
      pendingUpdateSha = sha;
      notify(t("Бот обновляется"), t("Скачана версия {sha}, перезапускаю.", { sha: sha.slice(0, 7) }));
    });
    bot.on("exit", ({ code, signal, uptimeMs, planned }) => {
      stopPolling();
      forgetChild();
      lastStatus = null;
      phase.reset();
      const how = signal ? t("сигнал {s}", { s: signal }) : t("код {c}", { c: code });
      const secs = Math.round(uptimeMs / 1000);
      addLog("app", planned ? t("бот вышел ({how}) через {secs} с, перезапуск", { how, secs }) : t("бот вышел ({how}) через {secs} с", { how, secs }));
      if (!planned && code !== 0) lastError = t("Бот завершился с ошибкой ({how}). Подробности в логе.", { how });
      pushState();
    });
    bot.on("waiting", ({ delayMs }) => addLog("app", t("перезапуск через {secs} с", { secs: Math.round(delayMs / 100) / 10 })));
    bot.on("crashloop", () => {
      lastError = t("Бот падает при запуске раз за разом. Открой лог: там причина.");
      notify(t("Бот падает при запуске"), t("Три падения подряд. Окно продолжает пробовать, причина в логе."));
      pushState();
    });
    bot.on("slow", () => addLog("app", t("страница бота долго не поднимается, жду дальше")));
    void bot.start();
  }

  function startPolling() {
    stopPolling();
    const tick = async () => {
      if (bot === null || bot.state !== "running") return;
      try {
        const body = await bot.status();
        if (body && typeof body === "object" && body.status) {
          const before = JSON.stringify(summary(lastStatus));
          lastStatus = body.status;
          if (typeof body.version === "string") botVersion = body.version;
          for (const ev of phase.update(lastStatus.phase, lastStatus.offlineReason, Date.now())) {
            if (ev.kind === "disconnected") notify(t("Бот отключился"), ev.reason ? t("Причина: {reason}. Переподключаюсь.", { reason: ev.reason }) : t("Переподключаюсь."));
            if (ev.kind === "reconnected") notify(t("Бот снова в игре"), t("Сервер {server}", { server: lastStatus.server }));
          }
          if (JSON.stringify(summary(lastStatus)) !== before) pushState();
        }
      } catch {

      }
    };
    void tick();
    pollTimer = setInterval(tick, 1500);
  }

  const summary = (s) =>
    s === null ? null : [s.phase, s.mode, s.acting, s.server, s.name, s.targetName, s.brain, s.offlineReason];

  function stopPolling() {
    if (pollTimer !== null) clearInterval(pollTimer);
    pollTimer = null;
  }

  async function togglePause() {
    if (bot === null || bot.state !== "running") {
      toast(t("Бот ещё не запущен"), "warn");
      return { ok: false };
    }
    const wasPaused = isPaused();
    try {
      let resumeMode = "fight";
      if (wasPaused) {

        resumeMode = modeBeforePause === "passive" ? "passive" : "fight";
        await bot.command(resumeMode === "passive" ? "!mode passive" : "!go");
        modeBeforePause = null;
      } else {
        const m = lastStatus !== null ? lastStatus.mode : null;
        modeBeforePause = typeof m === "string" && m !== "hold" && m !== "goto" ? m : null;

        await bot.command("!mode hold");
      }
      lastStatus = { ...(lastStatus ?? {}), mode: wasPaused ? resumeMode : "hold", acting: wasPaused };
      toast(wasPaused ? t("Бот снова играет") : t("Бот на паузе: стоит на месте"));
      pushState();
      return { ok: true, paused: !wasPaused };
    } catch (err) {
      toast(t("Не вышло: {err}", { err: tr(err.message) }), "error");
      return { ok: false };
    }
  }

  async function restartBot() {
    if (bot === null) {
      startBot();
      return;
    }
    addLog("app", t("перезапуск по кнопке"));
    lastError = "";
    await bot.restart();
  }

  function setLanguage() {
    const before = lang;
    applyLang();
    if (lang === before) return;
    if (bot !== null && bot.state === "running") void bot.command(`!lang ${lang}`).catch(() => {});
    trayKey = "";
    taskbarKey = "";
    if (win !== null && !win.isDestroyed()) setImmediate(() => void win.webContents.loadURL(`${shellUrl()}#settings`));
  }

  const workAreas = () => screen.getAllDisplays().map((d) => d.workArea);

  function createWindow() {
    const saved = visibleBounds(prefs.get("bounds"), workAreas());
    win = new BrowserWindow({
      ...(saved ?? { width: 1320, height: 860 }),
      minWidth: NORMAL_MIN.width,
      minHeight: NORMAL_MIN.height,
      frame: false,
      show: false,
      backgroundColor: BG,
      title: "DDNet AI",
      icon: path.join(APP_DIR, "icons", process.platform === "win32" ? "app.ico" : "app-256.png"),
      webPreferences: {
        preload: path.join(APP_DIR, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        sandbox: true,
        webviewTag: false,
        spellcheck: false,
        devTools: !app.isPackaged || process.env.DDNET_AI_DEVTOOLS === "1",
      },
    });
    if (saved === null) win.center();

    pendingMaximize = prefs.get("maximized") === true;
    win.once("ready-to-show", () => {
      if (!START_HIDDEN) revealWindow();
    });
    void win.loadURL(shellUrl());

    const remember = () => {
      if (win.isDestroyed() || win.isMaximized() || win.isMinimized() || win.isFullScreen()) return;
      if (mini) prefs.set({ miniBounds: win.getBounds() });
      else prefs.set({ bounds: win.getBounds() });
    };
    win.on("resize", remember);
    win.on("move", remember);
    win.on("maximize", () => {
      if (!mini) prefs.set({ maximized: true });
      pushState();
    });
    win.on("unmaximize", () => {
      if (!mini) prefs.set({ maximized: false });
      pushState();
    });
    win.on("show", () => {

      taskbarKey = "";
      updateTaskbar();
      updateTray();
    });
    win.on("hide", updateTray);
    win.on("focus", () => {
      lastFocusAt = Date.now();
    });
    win.on("blur", () => {
      lastFocusAt = Date.now();
    });
    win.on("close", (e) => {
      if (quitting) return;

      if (tray === null || !prefs.get("closeToTray")) {
        e.preventDefault();
        quit();
        return;
      }
      e.preventDefault();
      win.hide();
      if (!prefs.get("trayHintShown")) {
        prefs.set({ trayHintShown: true });
        notify(t("DDNet AI работает в трее"), t("Бот продолжает играть. Выход: правый клик по значку в трее."));
      }
    });
    win.on("closed", () => {
      win = null;
    });
    win.webContents.on("render-process-gone", (_e, d) => {
      if (d.reason === "clean-exit" || win === null || win.isDestroyed() || quitting) return;
      const now = Date.now();
      crashReloads = crashReloads.filter((t) => now - t < 60_000);
      if (crashReloads.length < 3) {
        crashReloads.push(now);
        addLog("app", t("окно упало ({reason}), перезагружаю", { reason: d.reason }));
        void win.webContents.loadURL(shellUrl());
        return;
      }
      addLog("app", t("окно упало ({reason}) в {n}-й раз за минуту", { reason: d.reason, n: crashReloads.length + 1 }));
      void dialog
        .showMessageBox({
          type: "error",
          title: "DDNet AI",
          message: t("Окно DDNet AI падает раз за разом."),
          detail: t("Бот при этом работает. Можно попробовать открыть окно заново или выйти совсем."),
          buttons: [t("Открыть заново"), t("Выйти")],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        })
        .then((r) => {
          if (r.response === 1) return quit();
          crashReloads = [];
          if (win !== null && !win.isDestroyed()) void win.webContents.loadURL(shellUrl());
        });
    });
  }

  function revealWindow() {
    if (win === null || win.isDestroyed()) return;
    if (pendingMaximize && !mini) {
      pendingMaximize = false;
      win.maximize();
    }
    win.show();
  }

  function showWindow() {
    if (win === null) createWindow();
    if (win.isMinimized()) win.restore();
    revealWindow();
    win.focus();
  }

  function toggleWindow() {
    if (win === null || !win.isVisible() || win.isMinimized()) return showWindow();
    const front = win.isFocused() || Date.now() - lastFocusAt < 400;
    if (front) win.hide();
    else showWindow();
  }

  function setMini(on) {
    if (win === null || on === mini) return;
    if (on) {
      wasMaximized = win.isMaximized();
      normalBounds = wasMaximized ? prefs.get("bounds") : win.getBounds();

      mini = true;
      if (wasMaximized) win.unmaximize();

      win.setMaximizable(false);
      win.setMinimumSize(320, 220);
      const area = screen.getDisplayMatching(win.getBounds()).workArea;
      const def = {
        width: MINI_DEFAULT.width,
        height: MINI_DEFAULT.height,
        x: area.x + area.width - MINI_DEFAULT.width - 16,
        y: area.y + area.height - MINI_DEFAULT.height - 16,
      };
      win.setBounds(visibleBounds(prefs.get("miniBounds"), workAreas()) ?? def);
      win.setAlwaysOnTop(true, "floating");
    } else {
      mini = false;
      win.setMaximizable(true);
      win.setAlwaysOnTop(onTop, "floating");
      win.setMinimumSize(NORMAL_MIN.width, NORMAL_MIN.height);
      if (normalBounds !== null) win.setBounds(normalBounds);
      if (wasMaximized) win.maximize();
    }
    pushState();
  }

  function setOnTop(on) {
    onTop = on;
    if (win !== null && !mini) win.setAlwaysOnTop(on, "floating");
    pushState();
  }

  function trayImage(active) {
    const file = path.join(APP_DIR, "icons", active ? "tray.png" : "tray-grey.png");
    return nativeImage.createFromPath(file);
  }

  function statusText() {
    if (root === null) return t("папка бота не найдена");
    if (screenName() === "setup") return t("ждёт первой настройки");
    if (bot === null || bot.state !== "running") return bot !== null && bot.state === "waiting" ? t("перезапуск") : t("запуск");
    if (lastStatus === null) return t("запущен");
    if (isPaused()) return t("пауза");
    if (lastStatus.phase === "online") return t("играет на {server}", { server: lastStatus.server });
    if (lastStatus.phase === "connecting") return t("подключается");
    return t("не на сервере");
  }

  function updateTray() {
    if (tray === null) return;
    const running = bot !== null && bot.state === "running";
    const active = running && lastStatus !== null && lastStatus.phase === "online" && !isPaused();
    const visible = win !== null && win.isVisible();
    const key = JSON.stringify([running, active, visible, isPaused(), mini, statusText(), prefs.get("hotkey"), lang]);
    if (key === trayKey) return;
    trayKey = key;
    tray.setImage(trayImage(active));
    tray.setToolTip(`DDNet AI: ${statusText()}`);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `DDNet AI: ${statusText()}`, enabled: false },
        { type: "separator" },
        { label: visible ? t("Спрятать окно") : t("Показать окно"), click: toggleWindow },
        { label: t("Мини-режим поверх окон"), type: "checkbox", checked: mini, click: () => { showWindow(); setMini(!mini); } },
        { type: "separator" },
        {
          label: isPaused() ? t("Продолжить игру") : t("Пауза"),

          ...(process.platform === "linux" ? {} : { accelerator: prefs.get("hotkey"), registerAccelerator: false }),
          enabled: running,
          click: () => void togglePause(),
        },
        { label: t("Перезапустить бота"), enabled: bot !== null, click: () => void restartBot() },
        { type: "separator" },
        { label: t("Открыть папку записей"), enabled: root !== null, click: () => void runAction("openClips") },
        { label: t("Собрать отчёт об ошибке..."), enabled: root !== null, click: () => void runAction("collectArchive") },
        { label: t("Открыть папку бота"), enabled: root !== null, click: () => void runAction("openProject") },
        { type: "separator" },
        { label: t("Выход"), click: () => quit() },
      ]),
    );
  }

  function createTray() {
    try {
      tray = new Tray(trayImage(false));
      tray.on("click", () => void toggleWindow());
      trayKey = "";
      updateTray();
    } catch (err) {
      tray = null;
      addLog("app", t("значок в трее недоступен: {err}", { err: err.message }));
    }
  }

  function registerHotkey(accel) {
    globalShortcut.unregisterAll();
    hotkeyError = "";
    try {
      if (!globalShortcut.register(accel, () => void togglePause())) {
        hotkeyError = t("Сочетание {key} уже занято другой программой", { key: accel });
        return false;
      }
      return true;
    } catch (err) {
      hotkeyError = t("Сочетание не подходит: {err}", { err: err.message });
      return false;
    }
  }

  function demoDir() {
    const cands =
      process.platform === "win32"
        ? [path.join(app.getPath("appData"), "DDNet", "demos"), path.join(app.getPath("appData"), "Teeworlds", "demos")]
        : [path.join(app.getPath("home"), ".local", "share", "ddnet", "demos"), path.join(app.getPath("home"), ".teeworlds", "demos")];
    return cands.find((d) => fs.existsSync(d)) ?? app.getPath("documents");
  }

  async function collectArchive() {
    if (root === null) return;
    const parent = win !== null && win.isVisible() ? win : undefined;
    const choice = await dialog.showMessageBox(parent, {
      type: "question",
      title: t("Отчёт об ошибке"),
      message: t("Собрать записи бота в один zip на рабочем столе?"),
      detail: t("Войдут записи (runs/clips), итоги A/B, память фриза, лог окна и настройки без пароля. Ключ обновлений не попадёт."),
      buttons: [t("Добавить демки..."), t("Без демок"), t("Отмена")],
      defaultId: 1,
      cancelId: 2,
      noLink: true,
    });
    if (choice.response === 2) return;
    let demos = [];
    if (choice.response === 0) {
      const r = await dialog.showOpenDialog(parent, {
        title: t("Какие демки добавить"),
        defaultPath: demoDir(),
        properties: ["openFile", "multiSelections"],
        filters: [{ name: t("Демки DDNet"), extensions: ["demo"] }],
      });
      if (r.canceled) return;
      demos = r.filePaths;
    }
    const logText = logBuf.toArray().map((l) => `${new Date(l.t).toISOString()} [${l.s}] ${l.text}`).join("\n");
    const plan = planArchive(root, { demos, logText, settings: settingsLib.readSettings(root) });
    const out = freeArchivePath(app.getPath("desktop"), archiveName(new Date()));
    toast(t("Собираю архив: {n} файлов...", { n: plan.entries.length }));
    try {
      let last = 0;
      const res = await writeZip(out, plan.entries, (done, total) => {
        const now = Date.now();
        if (now - last > 150 || done === total) {
          last = now;
          send("progress", { done, total });
        }
      });
      const mb = (res.bytes / 1048576).toFixed(1);
      addLog("app", t("архив готов: {file} ({n} файлов, {mb} МБ)", { file: out, n: res.files, mb }));
      for (const s of plan.skipped) addLog("app", tr(s));
      for (const name of res.skipped) addLog("app", t("не вошёл в архив: {name} (бот удалил его, пока архив собирался)", { name }));
      toast(t("Архив на рабочем столе: {file} ({mb} МБ)", { file: path.basename(out), mb }), "ok");
      shell.showItemInFolder(out);
    } catch (err) {
      toast(t("Архив не собрался: {err}", { err: tr(err.message) }), "error");
    }
  }

  function desktopShortcut() {
    if (process.platform !== "win32") return;
    const lnk = path.join(app.getPath("desktop"), "DDNet AI.lnk");
    const ok = shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? "replace" : "create", {
      target: process.execPath,
      args: app.isPackaged ? "" : `"${app.getAppPath()}"`,
      cwd: path.dirname(process.execPath),

      icon: path.join(APP_DIR, "icons", "app.ico"),
      iconIndex: 0,
      description: t("DDNet AI: окно бота"),
      appUserModelId: APP_ID,
    });
    toast(ok ? t("Ярлык DDNet AI на рабочем столе") : t("Ярлык не создался"), ok ? "ok" : "error");
  }

  async function openDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
    const err = await shell.openPath(dir);
    if (err) toast(t("Не открылась папка: {err}", { err }), "error");
  }

  async function chooseRoot() {
    const r = await dialog.showOpenDialog(win ?? undefined, {
      title: t("Где лежит бот (папка с start.mjs)"),
      properties: ["openDirectory"],
    });
    if (r.canceled || r.filePaths.length === 0) return { ok: false };
    const dir = r.filePaths[0];
    if (!isProjectRoot(dir, (p) => fs.existsSync(p))) {
      toast(t("В этой папке нет start.mjs и src/bot/web.ts"), "error");
      return { ok: false };
    }
    root = dir;
    prefs.set({ projectRoot: dir });
    pushState();

    if (await checkForeignBot()) startBot();
    return { ok: true };
  }

  const ACTIONS = {
    openClips: () => (root === null ? undefined : openDir(path.join(root, "runs", "clips"))),
    openProject: () => (root === null ? undefined : openDir(root)),
    openUserData: () => openDir(app.getPath("userData")),
    openInBrowser: () => (bot !== null && bot.state === "running" ? shell.openExternal(`http://127.0.0.1:${bot.port}/?lang=${lang}`) : undefined),
    collectArchive,
    chooseRoot,
    desktopShortcut,
    quit: () => quit(),
  };

  async function runAction(name) {
    const fn = Object.prototype.hasOwnProperty.call(ACTIONS, name) ? ACTIONS[name] : null;
    if (fn === null) throw new Error(t("неизвестное действие"));
    return fn();
  }

  async function fetchServers(force) {
    if (!force && serverCache !== null && Date.now() - serverCache.at < 30_000) return serverCache.payload;
    let lastErr = null;
    for (const url of MASTERS) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { "user-agent": `ddnet-ai-app/${app.getVersion()}` } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = parseServerList(await res.json());
        if (rows.length === 0) throw new Error(t("пустой список"));
        const payload = { ok: true, rows, source: new URL(url).host, at: Date.now() };
        serverCache = { at: Date.now(), payload };
        return payload;
      } catch (err) {
        lastErr = err;
      }
    }
    return { ok: false, error: t("Мастер-серверы DDNet не ответили ({err})", { err: lastErr ? lastErr.message : "?" }), rows: [] };
  }

  function trusted(e) {
    const url = e.senderFrame ? e.senderFrame.url : "";
    return win !== null && e.sender === win.webContents && url.startsWith(`${SHELL_ORIGIN}/`);
  }

  function handle(channel, fn) {
    ipcMain.handle(channel, async (e, ...args) => {
      if (!trusted(e)) throw new Error(t("запрещено"));
      return fn(...args);
    });
  }

  function setupIpc() {
    handle("win:minimize", () => win.minimize());
    handle("win:toggleMaximize", () => {
      if (mini) return;
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    });
    handle("win:close", () => win.close());
    handle("win:setMini", (on) => setMini(on === true));
    handle("win:setOnTop", (on) => setOnTop(on === true));
    handle("bot:togglePause", () => togglePause());
    handle("bot:restart", () => restartBot());
    handle("state:get", () => getState());
    handle("setup:get", () => {
      const s = root === null ? null : settingsLib.readSettings(root);
      return { settings: settingsLib.publicSettings(s), configured: settingsLib.isConfigured(s), limits: settingsLib.LIMITS };
    });
    handle("start:get", () => {
      const s = root === null ? null : settingsLib.readSettings(root);
      return { current: settingsLib.publicSettings(s), history: prefs.get("history"), countdown: START_COUNTDOWN_S, gate: startGate };
    });

    handle("start:play", async (index) => {
      if (root === null) return { ok: false, error: t("Не найдена папка бота") };
      if (Number.isInteger(index)) {
        const h = prefs.get("history")[index];
        if (h === undefined) return { ok: false, error: t("Нет такой записи") };
        const res = settingsLib.validateSetup({ server: h.server, name: h.name, clan: h.clan, skin: h.skin, brain: h.brain });
        if (!res.ok) return { ok: false, error: Object.values(res.errors).map((v) => tr(v)).join("; ") };
        try {
          const saved = settingsLib.saveSetup(root, res.value);
          if (saved.clearedPassword) toast(t("Сервер другой: сохранённый пароль стёрт"), "warn");
        } catch (err) {
          return { ok: false, error: t("Не записалось: {err}", { err: err.message }) };
        }
      }
      await releaseStart();
      return { ok: true };
    });
    handle("start:forget", (index) => {
      if (!Number.isInteger(index)) return { ok: false };
      prefs.set({ history: prefs.get("history").filter((_h, i) => i !== index) });
      return { ok: true, history: prefs.get("history") };
    });
    handle("setup:save", async (form) => {
      if (root === null) return { ok: false, errors: { server: t("Не найдена папка бота") } };
      const res = settingsLib.validateSetup(form);
      if (!res.ok) return { ok: false, errors: Object.fromEntries(Object.entries(res.errors).map(([k, v]) => [k, tr(v)])) };
      const firstRun = screenName() === "setup";
      let saved;
      try {
        saved = settingsLib.saveSetup(root, res.value);
      } catch (err) {
        return { ok: false, errors: { server: t("Не записалось: {err}", { err: err.message }) } };
      }
      addLog("app", t("настройки бота сохранены"));
      if (saved.clearedPassword) toast(t("Сервер другой: сохранённый пароль стёрт"), "warn");
      pushState();

      if (startGate) await releaseStart();

      else if (firstRun) {
        if (await checkForeignBot()) startBot();
      } else await restartBot();
      return { ok: true };
    });
    handle("servers:list", (force) => fetchServers(force === true));
    handle("servers:play", async (address, name, password) => {
      if (!isAddress(address)) throw new Error(t("плохой адрес"));
      const label = typeof name === "string" ? name.slice(0, 128) : "";
      if (password !== undefined && (typeof password !== "string" || password.length > settingsLib.LIMITS.password)) {
        throw new Error(t("плохой пароль"));
      }
      if (root === null) throw new Error(t("не найдена папка бота"));
      if (screenName() === "setup") return { ok: true, setupOnly: true };
      const saved = settingsLib.setServer(root, address, password);
      if (saved.clearedPassword) toast(t("Сервер другой: сохранённый пароль стёрт"), "warn");
      prefs.set({ recent: pushRecent(prefs.get("recent"), { address, name: label }, Date.now()) });
      addLog("app", label ? t("сервер сменён на {addr} ({name})", { addr: address, name: label }) : t("сервер сменён на {addr}", { addr: address }));
      toast(t("Захожу на {where}...", { where: label || address }));

      if (startGate) await releaseStart();
      else await restartBot();
      return { ok: true };
    });
    handle("servers:favorite", (address, on) => {
      if (!isAddress(address)) throw new Error(t("плохой адрес"));
      const favs = new Set(prefs.get("favorites"));
      if (on === true) favs.add(address);
      else favs.delete(address);
      prefs.set({ favorites: [...favs] });
      return [...favs];
    });
    handle("log:get", () => logBuf.toArray());
    handle("prefs:get", () => {
      const login = loginItem();
      return {
        hotkey: prefs.get("hotkey"),
        defaultHotkey: DEFAULT_HOTKEY,
        closeToTray: prefs.get("closeToTray"),
        notifications: prefs.get("notifications"),
        favorites: prefs.get("favorites"),
        recent: prefs.get("recent"),
        logOpen: prefs.get("logOpen"),
        logHeight: prefs.get("logHeight"),
        loginSupported: login.supported,
        openAtLogin: login.on,
        trayAvailable: tray !== null,
        lang: prefs.get("lang"),
        startScreen: prefs.get("startScreen"),
      };
    });
    handle("prefs:set", (patch) => {
      if (patch === null || typeof patch !== "object") throw new Error(t("плохие настройки"));
      const out = {};
      if ("hotkey" in patch) {
        if (!isValidAccelerator(patch.hotkey)) return { ok: false, error: t("Такое сочетание не подходит") };
        const old = prefs.get("hotkey");
        if (!registerHotkey(patch.hotkey)) {
          const error = hotkeyError;
          registerHotkey(old);
          return { ok: false, error };
        }
        out.hotkey = patch.hotkey;
      }
      for (const k of ["closeToTray", "notifications", "logOpen", "startScreen"]) {
        if (k in patch) {
          if (typeof patch[k] !== "boolean") throw new Error(t("плохое значение {key}", { key: k }));
          out[k] = patch[k];
        }
      }
      if ("logHeight" in patch) {
        if (!Number.isInteger(patch.logHeight) || patch.logHeight < 0 || patch.logHeight > 5000) throw new Error(t("плохое значение {key}", { key: "logHeight" }));
        out.logHeight = patch.logHeight;
      }
      if ("openAtLogin" in patch) {
        if (typeof patch.openAtLogin !== "boolean") throw new Error(t("плохое значение {key}", { key: "openAtLogin" }));
        setLoginItem(patch.openAtLogin);
      }
      if ("lang" in patch) {
        if (!["auto", "ru", "en"].includes(patch.lang)) throw new Error(t("плохое значение {key}", { key: "lang" }));
        out.lang = patch.lang;
      }
      prefs.set(out);
      if ("lang" in out) setLanguage();
      pushState();
      return { ok: true };
    });
    handle("app:action", (name) => {
      if (typeof name !== "string") throw new Error(t("плохое действие"));
      return runAction(name);
    });
    handle("app:copy", (text) => {
      if (typeof text !== "string" || text.length > 10000) throw new Error(t("плохой текст"));
      clipboard.writeText(text);
    });
  }

  function loginArgs() {
    return app.isPackaged ? ["--hidden"] : [app.getAppPath(), "--hidden"];
  }

  function loginItem() {
    const supported = process.platform === "win32" || process.platform === "darwin";
    if (!supported) return { supported, on: false };
    const s = app.getLoginItemSettings({ path: process.execPath, args: loginArgs() });
    return { supported, on: s.openAtLogin === true };
  }

  function setLoginItem(on) {
    if (process.platform !== "win32" && process.platform !== "darwin") return;
    app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: loginArgs() });
  }

  function botOrigin(url) {
    try {
      const u = new URL(url);
      return (
        u.protocol === "http:" &&
        (u.hostname === "127.0.0.1" || u.hostname === "localhost") &&
        bot !== null &&
        Number(u.port) === bot.port
      );
    } catch {
      return false;
    }
  }

  function openExternalSafe(url) {
    try {
      const u = new URL(url);
      if ((u.protocol === "https:" || u.protocol === "http:") && !botOrigin(url)) void shell.openExternal(u.toString());
    } catch {

    }
  }

  function hardenSessions() {
    const ses = session.defaultSession;

    ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "clipboard-sanitized-write"));
    ses.setPermissionCheckHandler((_wc, permission) => permission === "clipboard-sanitized-write");

    ses.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (d, cb) => {
      const u = d.url.replace(/^ws/, "http");
      cb({ cancel: !botOrigin(u) });
    });

    app.on("web-contents-created", (_e, contents) => {
      contents.setWindowOpenHandler(({ url }) => {
        openExternalSafe(url);
        return { action: "deny" };
      });
      contents.on("will-frame-navigate", (e) => {
        const ok = e.isMainFrame ? e.url.startsWith(`${SHELL_ORIGIN}/`) : botOrigin(e.url) || e.url === "about:blank";
        if (!ok) {
          e.preventDefault();
          openExternalSafe(e.url);
        }
      });
      contents.on("will-attach-webview", (e) => e.preventDefault());
    });
  }

  function registerShellProtocol() {
    const TYPES = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".ico": "image/x-icon",
    };
    protocol.handle("app", (req) => {
      const u = new URL(req.url);
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, "");
      const full = path.resolve(APP_DIR, rel);
      const inside = ["ui", "icons"].some((d) => full.startsWith(path.join(APP_DIR, d) + path.sep));
      const type = TYPES[path.extname(full).toLowerCase()];
      if (u.host !== "shell" || !inside || type === undefined || !fs.existsSync(full)) {
        return new Response("not found", { status: 404 });
      }
      return new Response(fs.readFileSync(full), { headers: { "content-type": type, "cache-control": "no-store" } });
    });
  }

  async function shot(name) {
    if (win === null) return;
    const img = await win.webContents.capturePage();
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    fs.writeFileSync(path.join(SHOT_DIR, `${name}.png`), img.toPNG());
    addLog("app", t("снимок: {file}", { file: `${name}.png` }));
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shellJs = (code) => win.webContents.executeJavaScript(code, true);

  async function runShots() {
    const until = async (cond, ms) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (cond()) return true;
        await wait(250);
      }
      return false;
    };
    await wait(1500);
    if (screenName() === "noroot") {
      await shot("noroot");
      if (hasFlag("--shots-quit")) quit();
      return;
    }
    if (screenName() === "setup") {
      await shot("setup-first-run");

      let answers = { server: "127.0.0.1:1", name: "AI-Tee", clan: "ai", skin: "cammostripes", brain: "planner" };
      try {
        if (process.env.DDNET_AI_SHOT_SETUP) answers = { ...answers, ...JSON.parse(process.env.DDNET_AI_SHOT_SETUP) };
      } catch {

      }
      await shellJs(`window.__debug.fillSetup(${JSON.stringify(answers)})`);
      await wait(400);
      await shot("setup-filled");
      await shellJs("window.__debug.submitSetup()");
    }
    await until(() => readyCount > 0, 120_000);
    await wait(Number(process.env.DDNET_AI_SHOT_WAIT) || 6000);
    await shot("main");

    const page = () => (win.webContents.mainFrame.frames || []).find((f) => botOrigin(f.url));
    const board = (on) => page()?.executeJavaScript(`(()=>{const b=document.querySelector('#tboard');if(b&&b.classList.contains('on')!==${on})b.click();return 1})()`).catch(() => 0);
    await board(true);
    await wait(1500);
    await shot("board");
    await board(false);
    await togglePause();
    await wait(2500);
    await shot("paused");
    await togglePause();
    await shellJs("window.__debug.open('servers')");
    await wait(7000);
    await shot("servers");
    await shellJs("window.__debug.serverSearch('block')");
    await wait(800);
    await shot("servers-search");
    await shellJs("window.__debug.close()");
    await shellJs("window.__debug.open('settings')");
    await wait(1200);
    await shot("settings");
    await shellJs("window.__debug.close()");
    await shellJs("window.__debug.toggleLog(true)");
    await wait(1000);
    await shot("log");
    await shellJs("window.__debug.toggleLog(false)");
    await shellJs("window.__debug.editSetup()");
    await wait(1000);
    await shot("setup-edit");
    await shellJs("window.__debug.close()");
    setMini(true);
    await wait(4000);
    await shot("mini");
    addLog("app", `mini: ${await shellJs("JSON.stringify([...document.querySelectorAll('#titlebar button')].map(b=>[b.id,Math.round(b.getBoundingClientRect().x),Math.round(b.getBoundingClientRect().width)]))")}`);
    setMini(false);
    await wait(1500);
    await shot("main-after-mini");
    if (hasFlag("--shots-quit")) quit();
  }

  let stopping = false;
  function quit() {
    quitting = true;
    app.quit();
  }

  app.on("before-quit", (e) => {
    quitting = true;
    if (stopping || bot === null || bot.state === "stopped") return;
    e.preventDefault();
    stopping = true;
    stopPolling();
    void bot.stop().finally(() => app.quit());
  });

  app.on("will-quit", () => globalShortcut.unregisterAll());
  process.on("exit", () => {
    if (bot !== null) bot.killNow();
  });
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => {
      if (bot !== null) bot.killNow();
      quit();
    });
  }

  app.on("second-instance", () => showWindow());
  app.on("window-all-closed", () => {
    if (quitting || tray === null || !prefs.get("closeToTray")) quit();
  });

  app.whenReady().then(async () => {
    prefs = new PrefStore(app.getPath("userData"));

    startGate = !SHOT_DIR && !PLAY_NOW && !START_HIDDEN && prefs.get("startScreen") !== false;
    applyLang();
    Menu.setApplicationMenu(null);
    registerShellProtocol();
    hardenSessions();
    setupIpc();
    root = resolveRoot();
    createWindow();
    createTray();
    registerHotkey(prefs.get("hotkey"));
    if (root === null) addLog("app", t("папка бота не найдена: выбери её в окне"));
    ensureStartMenuShortcut();
    await stopOrphan();
    if (!(await checkForeignBot())) return;
    startBot();
    pushState();
    if (SHOT_DIR) void runShots().catch((err) => addLog("app", t("снимки: {err}", { err: err.message })));
  });

  app.on("quit", () => prefs && prefs.saveNow());
}
