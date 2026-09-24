import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
if (nodeMajor < 24) {
  const env = process.env;
  const ru = /^ru/i.test(env.DDNET_AI_LANG || env.LC_ALL || env.LC_MESSAGES || env.LANG || Intl.DateTimeFormat().resolvedOptions().locale);
  console.error(
    ru
      ? `Нужен Node.js 24 или новее, у тебя v${process.versions.node}. Скачать: https://nodejs.org/`
      : `Node.js 24 or newer is needed, this is v${process.versions.node}. Download: https://nodejs.org/`,
  );
  process.exit(1);
}

const { detectLang, getLang, isLang, setLang, t } = await import("./src/i18n.ts");

const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) continue;
  const key = argv[i].slice(2);
  const value = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
  flags[key] = value;
}

async function findPolicies() {
  const { OBS_SIZE } = await import("./src/env/obs.ts");
  const { ACTION_SIZE } = await import("./src/env/action.ts");
  const fits = (parsed) =>
    parsed && parsed.shape && parsed.params !== undefined &&
    parsed.shape.inputs === OBS_SIZE && parsed.shape.outputs === ACTION_SIZE;
  const found = [];
  for (const dir of [HERE, path.join(HERE, "runs")]) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        for (const f of ["best.json", "latest.json"]) {
          if (existsSync(path.join(full, f))) found.push(path.join(full, f));
        }
      } else if (entry.endsWith(".json") && entry !== "package.json" && entry !== "package-lock.json") {
        try {
          if (fits(JSON.parse(readFileSync(full, "utf8")))) found.push(full);
        } catch {

        }
      }
    }
  }
  return found;
}

function parseServer(text) {
  const at = text.lastIndexOf(":");
  if (at <= 0) return { host: text.trim(), port: 8303 };
  const port = Number.parseInt(text.slice(at + 1), 10);
  return { host: text.slice(0, at).trim(), port: Number.isFinite(port) ? port : 8303 };
}

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });

  const pending = [];
  let waiting = null;
  let closed = false;
  rl.on("line", (line) => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(line);
    } else {
      pending.push(line);
    }
  });
  rl.on("close", () => {
    closed = true;
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve("");
    }
  });
  const readLine = () =>
    new Promise((resolve) => {
      if (pending.length > 0) resolve(pending.shift());
      else if (closed) resolve("");
      else waiting = resolve;
    });

  const askRaw = async (text) => {

    if (closed && pending.length === 0) return "";
    rl.setPrompt(text);
    rl.prompt();
    const answer = (await readLine()).trim();

    if (!stdin.isTTY) stdout.write("\n");
    return answer;
  };

  const settingsFile = path.join(HERE, "settings.json");
  let saved = {};
  if (flags.setup === undefined) {
    try {
      saved = JSON.parse(readFileSync(settingsFile, "utf8"));
    } catch {
      saved = {};
    }
  }
  const remembered = Object.keys(saved).length > 0;
  setLang(isLang(flags.lang) ? flags.lang : detectLang(process.env, saved.lang));

  const ask = async (question, fallback) => {
    if (flags[question.key] !== undefined) return flags[question.key];
    if (remembered && saved[question.key] !== undefined) return saved[question.key];
    const suffix = fallback ? ` ${C.f}[${fallback}]${C.r}` : "";
    const answer = await askRaw(`  ${C.d}${question.text}${C.r}${suffix}${C.d}:${C.r} `);
    return answer.length > 0 ? answer : fallback;
  };

  const C = { d: "\x1b[2m", b: "\x1b[1m", g: "\x1b[38;5;108m", y: "\x1b[38;5;180m", bl: "\x1b[38;5;109m", f: "\x1b[38;5;242m", r: "\x1b[0m" };
  const line = (n) => `${C.f}${"\u2500".repeat(n)}${C.r}`;
  console.log(`
   ${C.g}\u256d\u2500\u2500\u2500\u256e${C.r}
   ${C.g}\u2502${C.r} ${C.b}\u25cf \u25cf${C.r} ${C.g}\u2502${C.r}   ${C.b}ddnet-ai${C.r}  ${C.f}${t("бот для DDNet, блок 1 на 1")}${C.r}
   ${C.g}\u2570\u2500\u2500\u2500\u256f${C.r}   ${C.f}${t("Enter: взять значение в скобках")}${C.r}
${line(56)}
`);

  const serverText = await ask({ key: "server", text: t("Сервер (ip:порт или auto)") }, "auto");

  const { isAuto, fetchMaster, pickBlockServer, readAvoid } = await import("./src/bot/serverPick.ts");
  const avoidFile = path.join(HERE, "runs", "server-avoid.json");
  const autoServer = isAuto(serverText);
  let address = serverText;
  if (autoServer) {
    for (;;) {
      let pick = null;
      try {
        pick = pickBlockServer(await fetchMaster(), { lang: getLang(), avoid: readAvoid(avoidFile) });
      } catch (err) {
        console.log(t("список серверов DDNet не загрузился: {err}", { err: err instanceof Error ? err.message : String(err) }));
      }
      if (pick !== null) {
        console.log(t("сервер выбран сам: {name} · {map} · {n} игроков", { name: pick.name, map: pick.map, n: pick.players }));
        address = pick.address;
        break;
      }
      console.log(t("живых блок-серверов не нашлось, ищу снова через 30 секунд"));
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
  const { host, port } = parseServer(address);
  const name = await ask({ key: "name", text: t("Ник бота") }, "AI-Tee");
  const clan = await ask({ key: "clan", text: t("Клан (пусто: без клана)") }, "");
  const skin = await ask({ key: "skin", text: t("Скин") }, "cammostripes");
  const password = await ask({ key: "password", text: t("Пароль сервера (пусто: без пароля)") }, "");

  let brainLabel = `${C.b}${t("скриптовый бот")}${C.r}`;
  const policies = await findPolicies();
  let policyFile;
  let usePlanner = flags.planner !== undefined;
  let bold = flags.bold !== undefined;
  if (flags.policy !== undefined) {
    policyFile = flags.policy;
  } else if (flags.scripted !== undefined || flags.planner !== undefined) {
    policyFile = null;
  } else if (remembered && saved.brain !== undefined) {
    usePlanner = saved.brain !== "scripted";
    bold = saved.brain === "bold";
    policyFile = null;
  } else if (policies.length === 0) {

    console.log(`\n${t("Обученных весов рядом не нашлось, играю планировщиком (он и так сильнее сети).")}`);
    console.log(`  p) ${t("планировщик")} ${C.f}${t("просчёт на полсекунды вперёд в настоящей физике")}${C.r} ${C.d}[${t("по умолчанию")}]${C.r}`);
    console.log(`  b) ${t("планировщик экспериментальный")} ${C.f}(${t("измерен слабее обычного на пять сигм, не бери")})${C.r}`);
    console.log(`  0) ${t("скриптовый бот без нейросети")} ${C.f}(${t("база для сравнения, играет слабо")})${C.r}`);
    const choice = (await askRaw(`  ${C.d}${t("Чем играть")}${C.r} ${C.f}[p]${C.r}${C.d}:${C.r} `)).trim().toLowerCase();
    policyFile = null;
    if (choice === "0") usePlanner = false;
    else {
      usePlanner = true;
      if (choice === "b") bold = true;
    }
  } else if (remembered && saved.brain !== undefined) {
    usePlanner = saved.brain !== "scripted";
    bold = saved.brain === "bold";
    policyFile = null;
  } else {
    console.log(`\n${t("Найденные веса:")}`);
    policies.forEach((p, i) => console.log(`  ${i + 1}) ${path.relative(HERE, p)}`));
    console.log(`  0) ${t("скриптовый бот без нейросети")}`);
    console.log(`  p) ${t("планировщик: просчитывает ходы вперёд в настоящей физике")} ${C.d}[${t("по умолчанию")}]${C.r}`);
    console.log(`  b) ${t("планировщик экспериментальный")} ${C.f}(${t("измерен слабее обычного на пять сигм, не бери")})${C.r}`);

    const choice = await askRaw(`  ${C.d}${t("Чем играть")}${C.r} ${C.f}[p]${C.r}${C.d}:${C.r} `);
    const trimmed = choice.trim().toLowerCase();
    if (trimmed === "b") {
      usePlanner = true;
      bold = true;
      policyFile = null;
    } else if (trimmed === "" || trimmed === "p") {
      usePlanner = true;
      policyFile = null;
    } else {
      const idx = Number.parseInt(trimmed, 10);
      policyFile = idx === 0 ? null : policies[idx - 1] ?? policies[0];
    }
  }

  try {

    let onDisk = saved;
    if (flags.setup !== undefined) {
      try {
        onDisk = JSON.parse(readFileSync(settingsFile, "utf8"));
      } catch {
        onDisk = {};
      }
    }
    const keep = typeof onDisk === "object" && onDisk !== null && !Array.isArray(onDisk) ? onDisk : {};

    const answers = JSON.stringify({ server: autoServer ? "auto" : serverText, name, clan, skin, password, brain: bold ? "bold" : usePlanner ? "planner" : "scripted" });
    writeFileSync(settingsFile, JSON.stringify({ ...keep, ...JSON.parse(answers) }, null, 2));
  } catch {

  }

  rl.close();

  const { DdnetBot } = await import("./src/bot/bot.ts");
  const { BotConsole } = await import("./src/bot/console.ts");
  const { PLANNER_BOLD } = await import("./src/bot/bot.ts");
  const { RecurrentPolicy } = await import("./src/nn/gru.ts");

  const loadFrom = policyFile ?? policies[0];
  let policy;
  if (loadFrom) {
    try {
      policy = RecurrentPolicy.fromJSON(JSON.parse(readFileSync(loadFrom, "utf8")));
    } catch (err) {
      console.log(`\n${t("Веса {file} не читаются: {err}", { file: path.relative(HERE, loadFrom), err: err instanceof Error ? err.message : String(err) })}`);
    }
  }
  if (policyFile && policy) {
    brainLabel = `${C.b}${t("сеть")}${C.r} ${C.f}${t("{file}, {n} параметров", { file: path.relative(HERE, policyFile), n: policy.params.length.toLocaleString(getLang() === "en" ? "en-US" : "ru-RU") })}${C.r}`;
  } else {
    brainLabel = usePlanner
      ? bold
        ? `${C.b}${t("планировщик, экспериментальный")}${C.r} ${C.f}${t("64 варианта x3 итерации в те же 18 мс")}${C.r}`
        : `${C.b}${t("планировщик")}${C.r} ${C.f}${t("просчёт на полсекунды вперёд в настоящей физике")}${C.r}`
      : `${C.b}${t("скриптовый бот")}${C.r}`;
    if (policy) brainLabel += ` ${C.f}(${t("сеть рядом есть: !brain net")})${C.r}`;
  }

  let opponentDirNet;
  const oppFile = path.join(HERE, "opponent.json");
  if (existsSync(oppFile)) {
    try {
      const { Mlp } = await import("./src/nn/mlp.ts");
      opponentDirNet = Mlp.fromJSON(JSON.parse(readFileSync(oppFile, "utf8")));
    } catch (err) {
      console.log(`\n${t("opponent.json не читается: {err}", { err: err instanceof Error ? err.message : String(err) })}`);
    }
  }

  const bot = new DdnetBot({
    host,
    port,
    name,
    clan: clan || undefined,
    skin,
    password: password || undefined,
    policy,
    scripted: !policyFile && !usePlanner,
    planner: usePlanner,
    plannerCfg: bold ? PLANNER_BOLD : undefined,
    opponentDirNet,
    mapDir: path.join(HERE, "maps"),
    settingsFile,
    autoServer,
    autoAvoidFile: avoidFile,
    protocolVersion: flags["protocol-version"] === undefined ? undefined : Number(flags["protocol-version"]),

    goto: flags.goto === undefined || flags.goto === "true" ? undefined : flags.goto,

    chat: false,
    reconnect: true,

    verbose: false,
  });

  console.log(`
${line(56)}
  ${C.bl}\u25b8${C.r} ${C.b}${host}:${port}${C.r}  ${C.f}${t("как")}${C.r} ${C.g}${name}${C.r}${clan ? ` ${C.f}[${clan}]${C.r}` : ""}
  ${C.bl}\u25b8${C.r} ${brainLabel}
  ${C.f}${t("!help: команды   ·   !goto tele: если сервер пускает только через телепорт")}${C.r}
  ${C.f}${t("!clip: сохранить последние 30 секунд   ·   !lang en: English   ·   ctrl+c: выход")}${C.r}
${line(56)}
`);

  let web = null;
  if (flags["no-web"] === undefined) {
    try {
      const { startWebUi } = await import("./src/bot/web.ts");
      const { currentVersion } = await import("./src/bot/autoUpdate.ts");
      web = await startWebUi(bot, Number(flags["web-port"] ?? 7777), currentVersion(HERE));
      const url = `http://localhost:${web.port}`;
      bot.onOutput((l) => web.push(l));
      console.log(`  ${C.bl}\u25b8${C.r} ${C.b}${url}${C.r} ${C.f}${t("окно бота")}${C.r}`);

      if (flags["ready-line"] !== undefined) console.log(`WEBUI_READY ${web.port}`);

      if (flags["no-open"] === undefined) {
        const opener = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
          : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
        try {
          (await import("node:child_process")).spawn(opener[0], opener[1], { stdio: "ignore", detached: true }).unref();
        } catch {

        }
      }
    } catch (err) {
      console.log(t("окно в браузере не поднялось ({err})", { err: err instanceof Error ? err.message : String(err) }));
      if (flags["ready-line"] !== undefined) console.log(`WEBUI_FAIL ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  let stopAutoUpdate = null;
  if (flags["no-update"] === undefined) {
    try {
      const { startAutoUpdate } = await import("./src/bot/autoUpdate.ts");
      const updater = startAutoUpdate(
        HERE,
        (e) => {
          const text = t("обновление: {reply}", { reply: e.text });

          if (e.kind === "applied" && e.sha && flags["ready-line"] !== undefined) console.log(`UPDATE_APPLIED ${e.sha}`);
          if (web !== null) web.push({ kind: "event", text });
          console.log(text);
        },

        () => void stop(75),
      );
      stopAutoUpdate = updater.stop;

      bot.checkUpdate = async () => {
        let said = "";
        const before = currentVersion(HERE);
        await updater.check();
        const after = currentVersion(HERE);
        said = after !== before ? t("обновлено до {sha}", { sha: after.slice(0, 7) }) : t("обновлений нет, стоит свежая версия");
        return said;
      };
    } catch {

    }
  }

  let stopping = false;
  const stop = async (code = 0) => {
    if (stopping) return;
    stopAutoUpdate?.();
    web?.close();
    stopping = true;
    ui?.stop();
    console.log(`\n${t("Отключаюсь...")}`);
    await bot.stop().catch(() => {});
    console.log(bot.statsLine ? bot.statsLine() : JSON.stringify(bot.stats));

    process.exit(typeof code === "number" ? code : 0);
  };

  const wantUi =
    flags["no-console"] !== undefined ? false
    : flags.console !== undefined ? true
    : web === null && stdin.isTTY === true;

  let ui = null;

  if ((wantUi || flags.ink !== undefined) && flags.plain === undefined && (stdin.isTTY === true || flags.ink !== undefined)) {
    try {
      const { startInkUi } = await import("./src/bot/ui.ts");
      ui = startInkUi(bot, () => void stop());
      if (ui === null) console.log(t("терминал не отдаёт клавиши напрямую, беру простую консоль"));
    } catch (err) {
      console.log(t("богатый интерфейс не поднялся ({err}), беру простой", { err: err instanceof Error ? err.message : String(err) }));
    }
  }
  if (ui === null && wantUi) ui = new BotConsole(bot, () => void stop());
  bot.onQuitRequested(() => void stop());

  bot.onSwitchRequested(() => {
    if (flags["ready-line"] !== undefined) console.log("SERVER_SWITCH");
    void stop(75);
  });
  process.on("SIGINT", stop);
  if (ui !== null && typeof ui.start === "function") ui.start();

  await bot.start();
}

main().catch((err) => {
  console.error(`\n${t("Ошибка: {err}", { err: err instanceof Error ? err.message : String(err) })}`);
  process.exit(1);
});
