import { parentPort, workerData } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { DdnetBot } from "./bot.ts";
import type { BotConfig } from "./bot.ts";
import { Mlp } from "../nn/mlp.ts";
import { setLang } from "../i18n.ts";
import type { DummyInit, DummyStatus, FromDummy, ToDummy } from "./dummyThread.ts";

const port = parentPort;
if (port === null) throw new Error("dummyWorker.ts runs only as a worker thread");
const init = workerData as DummyInit;
if (init.lang !== undefined) setLang(init.lang);

const cfg: BotConfig = { ...init.cfg };
if (init.opponentFile !== undefined) {
  try {
    cfg.opponentDirNet = Mlp.fromJSON(JSON.parse(readFileSync(init.opponentFile, "utf8")));
  } catch {

  }
}
const bot = new DdnetBot(cfg);
for (const [list, name] of init.relations) bot.setRelation(list, name, true);

const post = (m: FromDummy): void => port.postMessage(m);
bot.onOutput((line) => post({ t: "out", line }));

function status(): DummyStatus {
  const s = bot.status();
  return { phase: s.phase, frozen: s.frozen, acting: s.acting, mode: s.mode, wb: s.wb ?? null, target: s.targetName };
}

const statusTimer = setInterval(() => post({ t: "status", status: status() }), 250);

port.on("message", (m: ToDummy) => {
  switch (m.t) {
    case "start":
      bot.start().catch((err) => post({ t: "out", line: { kind: "event", text: err instanceof Error ? err.message : String(err) } }));
      return;
    case "console": {
      let reply: string;
      try {
        reply = bot.handleConsole(m.line);
      } catch (err) {
        reply = err instanceof Error ? err.message : String(err);
      }
      post({ t: "reply", id: m.id, text: reply });
      post({ t: "status", status: status() });
      return;
    }
    case "relation":
      bot.setRelation(m.list, m.name, m.on);
      return;
    case "stop":
      clearInterval(statusTimer);
      bot
        .stop()
        .catch(() => {})
        .finally(() => post({ t: "stopped" }));
      return;
  }
});
