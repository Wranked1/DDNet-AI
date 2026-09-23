import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
if (nodeMajor < 24) {
  console.error(`Нужен Node.js 24 или новее, у тебя v${process.versions.node}. Скачать: https://nodejs.org/`);
  process.exit(1);
}

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
   ${C.g}\u2502${C.r} ${C.b}\u25cf \u25cf${C.r} ${C.g}\u2502${C.r}   ${C.b}ddnet-ai${C.r}  ${C.f}\u0431\u043e\u0442 \u0434\u043b\u044f DDNet, \u0431\u043b\u043e\u043a 1\u043d\u04301${C.r}
   ${C.g}\u2570\u2500\u2500\u2500\u256f${C.r}   ${C.f}Enter \u2014 \u0432\u0437\u044f\u0442\u044c \u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435 \u0432 \u0441\u043a\u043e\u0431\u043a\u0430\u0445${C.r}
${line(56)}
`);

  const serverText = await ask({ key: "server", text: "Сервер (ip:порт)" }, "127.0.0.1:8303");
  const { host, port } = parseServer(serverText);
  const name = await ask({ key: "name", text: "Ник бота" }, "AI-Tee");
  const clan = await ask({ key: "clan", text: "Клан (пусто — без клана)" }, "");
  const skin = await ask({ key: "skin", text: "Скин" }, "cammostripes");
  const password = await ask({ key: "password", text: "Пароль сервера (пусто — без пароля)" }, "");

  let brainLabel = `${C.b}скриптовый бот${C.r}`;
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

    console.log("\nОбученных весов рядом не нашлось — играю планировщиком (он и так сильнее сети).");
    console.log(`  p) планировщик ${C.f}просчёт 1.2с вперёд в настоящей физике${C.r} ${C.d}[по умолчанию]${C.r}`);
    console.log(`  b) планировщик экспериментальный ${C.f}(измерен слабее обычного на пять сигм — не бери)${C.r}`);
    console.log(`  0) скриптовый бот без нейросети ${C.f}(база для сравнения, играет слабо)${C.r}`);
    const choice = (await askRaw(`  ${C.d}Чем играть${C.r} ${C.f}[p]${C.r}${C.d}:${C.r} `)).trim().toLowerCase();
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
    console.log("\nНайденные веса:");
    policies.forEach((p, i) => console.log(`  ${i + 1}) ${path.relative(HERE, p)}`));
    console.log(`  0) скриптовый бот без нейросети`);
    console.log(`  p) планировщик: просчитывает ходы вперёд в настоящей физике ${C.d}[по умолчанию]${C.r}`);
    console.log(`  b) планировщик экспериментальный ${C.f}(измерен слабее обычного на пять сигм — не бери)${C.r}`);

    const choice = await askRaw(`  ${C.d}Чем играть${C.r} ${C.f}[p]${C.r}${C.d}:${C.r} `);
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

    const answers = JSON.stringify({ server: serverText, name, clan, skin, password, brain: bold ? "bold" : usePlanner ? "planner" : "scripted" });
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
      console.log(`\nВеса ${path.relative(HERE, loadFrom)} не читаются: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (policyFile && policy) {
    brainLabel = `${C.b}сеть${C.r} ${C.f}${path.relative(HERE, policyFile)}, ${policy.params.length.toLocaleString("ru-RU")} параметров${C.r}`;
  } else {
    brainLabel = usePlanner
      ? bold
        ? `${C.b}планировщик, экспериментальный${C.r} ${C.f}64 варианта x3 итерации в те же 18 мс${C.r}`
        : `${C.b}планировщик${C.r} ${C.f}просчёт 1.2с вперёд в настоящей физике${C.r}`
      : `${C.b}скриптовый бот${C.r}`;
    if (policy) brainLabel += ` ${C.f}(сеть рядом есть: !brain net)${C.r}`;
  }

  let opponentDirNet;
  const oppFile = path.join(HERE, "opponent.json");
  if (existsSync(oppFile)) {
    try {
      const { Mlp } = await import("./src/nn/mlp.ts");
      opponentDirNet = Mlp.fromJSON(JSON.parse(readFileSync(oppFile, "utf8")));
    } catch (err) {
      console.log(`\nopponent.json не читается: ${err instanceof Error ? err.message : String(err)}`);
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
    protocolVersion: flags["protocol-version"] === undefined ? undefined : Number(flags["protocol-version"]),

    goto: flags.goto === undefined || flags.goto === "true" ? undefined : flags.goto,

    chat: false,
    reconnect: true,

    verbose: false,
  });

  console.log(`
${line(56)}
  ${C.bl}\u25b8${C.r} ${C.b}${host}:${port}${C.r}  ${C.f}\u043a\u0430\u043a${C.r} ${C.g}${name}${C.r}${clan ? ` ${C.f}[${clan}]${C.r}` : ""}
  ${C.bl}\u25b8${C.r} ${brainLabel}
  ${C.f}!help \u2014 \u043a\u043e\u043c\u0430\u043d\u0434\u044b   \u00b7   !goto tele \u2014 \u0435\u0441\u043b\u0438 \u0441\u0435\u0440\u0432\u0435\u0440 \u043f\u0443\u0441\u043a\u0430\u0435\u0442 \u0442\u043e\u043b\u044c\u043a\u043e \u0447\u0435\u0440\u0435\u0437 \u0442\u0435\u043b\u0435\u043f\u043e\u0440\u0442${C.r}
  ${C.f}!clip \u2014 \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0435 30 \u0441\u0435\u043a\u0443\u043d\u0434   \u00b7   ctrl+c \u2014 \u0432\u044b\u0445\u043e\u0434${C.r}
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
      console.log(`  ${C.bl}\u25b8${C.r} ${C.b}${url}${C.r} ${C.f}— окно бота${C.r}`);

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
      console.log(`окно в браузере не поднялось (${err instanceof Error ? err.message : String(err)})`);
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
          const text = `обновление: ${e.text}`;
          if (web !== null) web.push({ kind: "event", text });
          console.log(text);
        },
        () => void stop(),
      );
      stopAutoUpdate = updater.stop;

      bot.checkUpdate = async () => {
        let said = "";
        const before = currentVersion(HERE);
        await updater.check();
        const after = currentVersion(HERE);
        said = after !== before ? `обновлено до ${after.slice(0, 7)}` : "обновлений нет, стоит свежая версия";
        return said;
      };
    } catch {

    }
  }

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopAutoUpdate?.();
    web?.close();
    stopping = true;
    ui?.stop();
    console.log("\nОтключаюсь...");
    await bot.stop().catch(() => {});
    console.log(bot.statsLine ? bot.statsLine() : JSON.stringify(bot.stats));
    process.exit(0);
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
      if (ui === null) console.log("терминал не отдаёт клавиши напрямую — беру простую консоль");
    } catch (err) {
      console.log(`богатый интерфейс не поднялся (${err instanceof Error ? err.message : String(err)}), беру простой`);
    }
  }
  if (ui === null && wantUi) ui = new BotConsole(bot, () => void stop());
  bot.onQuitRequested(() => void stop());
  process.on("SIGINT", stop);
  if (ui !== null && typeof ui.start === "function") ui.start();

  await bot.start();
}

main().catch((err) => {
  console.error(`\nОшибка: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
