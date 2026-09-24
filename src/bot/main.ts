import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { vdistance } from "../core/vmath.ts";
import { RecurrentPolicy } from "../nn/gru.ts";
import { readFileSync } from "node:fs";
import { DdnetBot } from "./bot.ts";
import { BotConsole } from "./console.ts";

const DEFAULT_MAP_DIR = "vendor/DDNet-20.0-linux_x86_64/data/maps";

const USAGE = `usage: node src/bot/main.ts (--policy <checkpoint.json> | --scripted) [options]
  --server <ip:port>   server to join, e.g. 45.136.205.18:8304 (overrides --host/--port)
  --host <address>     server address (default 127.0.0.1)
  --port <n>           server port (default 8303)
  --name <nick>        player name (default AI-Tee)
  --policy <file>      MLP checkpoint JSON written by the trainer
  --planner            play with the look-ahead planner (searches real physics)
  --scripted           play the scripted baseline instead of a policy
  --target <name>      only fight the player with this name
  --goto <where>       walk somewhere once the map is parsed, then play normally:
                       "tele" for the nearest teleporter (servers that gate entry
                       on walking to one), "<x> <y>" in tile coordinates, or a
                       player's nick (followed until the bot is next to them).
                       Re-run after every reconnect and every map change.
  --map-dir <dir>      <map>.map lookup when the server's copy cannot be parsed
                       (default ${DEFAULT_MAP_DIR})
  --chat               answer !bot / !stop / !go / !stats in the GAME chat (off by default:
                       a bot that answers commands in public announces itself)
  --console            interactive console: type to chat, ?help for commands
  --brush-off          answer "bot?" in chat with a short reply after a pause
  --protocol-version <n>  DDNet version to announce (default 19000, needed for
                       128-player servers; 603 is the old, very conservative value)
  --no-console         force it off even on a terminal
  --no-reconnect       exit instead of reconnecting when the connection drops
  --verbose            log connection, target and periodic status lines
  --duration <sec>     stop after this many seconds and print stats (0 = forever)`;

function fail(msg: string): never {
  console.error(`error: ${msg}\n\n${USAGE}`);
  process.exit(2);
}

function printSummary(bot: DdnetBot): void {
  console.log(`stats: ${bot.statsLine()}`);
  const { start, end, distance } = bot.travel;
  if (start && end) {
    console.log(`start position: (${start.x}, ${start.y}) px = tile (${(start.x / 32).toFixed(2)}, ${(start.y / 32).toFixed(2)})`);
    console.log(`end position:   (${end.x}, ${end.y}) px = tile (${(end.x / 32).toFixed(2)}, ${(end.y / 32).toFixed(2)})`);
    console.log(`distance travelled: ${distance.toFixed(1)} px along the path, ${vdistance(start, end).toFixed(1)} px start-to-end`);
  } else {
    console.log("own tee was never seen alive");
  }
}

function main(): void {
  let values;
  try {
    values = parseArgs({
      options: {
        server: { type: "string" },
        host: { type: "string", default: "127.0.0.1" },
        port: { type: "string", default: "8303" },
        name: { type: "string", default: "AI-Tee" },
        clan: { type: "string" },
        "no-emotes": { type: "boolean", default: false },
        planner: { type: "boolean", default: false },
        console: { type: "boolean", default: false },
        "brush-off": { type: "boolean", default: false },
        "protocol-version": { type: "string" },
        "no-console": { type: "boolean", default: false },
        password: { type: "string" },
        skin: { type: "string" },
        country: { type: "string" },
        policy: { type: "string" },
        scripted: { type: "boolean", default: false },
        target: { type: "string" },
        goto: { type: "string" },
        "map-dir": { type: "string", default: DEFAULT_MAP_DIR },
        chat: { type: "boolean", default: false },
        "no-reconnect": { type: "boolean", default: false },
        verbose: { type: "boolean", default: false },
        duration: { type: "string", default: "0" },
      },
      strict: true,
    }).values;
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  let host = values.host;
  let portText = values.port;
  if (values.server !== undefined) {
    const at = values.server.lastIndexOf(":");
    if (at <= 0 || at === values.server.length - 1) fail(`--server must look like ip:port, got "${values.server}"`);
    host = values.server.slice(0, at);
    portText = values.server.slice(at + 1);
  }
  const port = Number.parseInt(portText, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) fail(`invalid --port '${values.port}'`);
  const duration = Number.parseFloat(values.duration);
  if (!Number.isFinite(duration) || duration < 0) fail(`invalid --duration '${values.duration}'`);

  const usePolicy = values.policy !== undefined;

  const modes = [usePolicy, values.scripted, values.planner].filter(Boolean).length;
  if (modes !== 1) fail("exactly one of --policy <checkpoint.json>, --scripted or --planner must be given");

  let policy: RecurrentPolicy | undefined;
  if (values.policy !== undefined) {
    if (!existsSync(values.policy)) fail(`policy checkpoint not found: ${values.policy}`);
    try {
      policy = RecurrentPolicy.fromJSON(JSON.parse(readFileSync(values.policy, "utf8")));
    } catch (err) {
      fail(`cannot load policy ${values.policy}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const bot = new DdnetBot({
    host,
    port,
    name: values.name,
    clan: values.clan,
    brushOff: values["brush-off"],
    protocolVersion: values["protocol-version"] === undefined ? undefined : Number(values["protocol-version"]),
    emotes: !values["no-emotes"],
    planner: values.planner,
    password: values.password,
    skin: values.skin,
    country: values.country === undefined ? undefined : Number.parseInt(values.country, 10),
    policy,
    scripted: values.scripted,
    mapDir: values["map-dir"],
    chat: values.chat,
    targetName: values.target,
    goto: values.goto,
    reconnect: !values["no-reconnect"],
    verbose: values.verbose,
  });

  const wantConsole = values["no-console"] === true ? false : values.console === true || process.stdin.isTTY === true;

  let shuttingDown = false;
  const shutdown = async (why: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    ui?.stop();
    console.log(`[main] ${why}, disconnecting`);
    await bot.stop();
    printSummary(bot);
    process.exit(0);
  };

  const ui = wantConsole ? new BotConsole(bot, () => void shutdown("quit")) : null;
  bot.onQuitRequested(() => void shutdown("?quit"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  if (duration > 0) setTimeout(() => void shutdown(`${duration}s elapsed`), duration * 1000);

  if (ui === null) {
    console.log(
      `[main] ${values.scripted ? "scripted baseline" : values.planner ? "planner" : `policy ${values.policy}`} -> ${host}:${port} as '${values.name}'` +
        (duration > 0 ? ` for ${duration}s` : ""),
    );
  }
  ui?.start();
  bot.start().catch(async (err: unknown) => {
    console.error(`[main] ${err instanceof Error ? err.message : String(err)}`);
    await bot.stop();
    printSummary(bot);
    process.exit(1);
  });
}

main();
