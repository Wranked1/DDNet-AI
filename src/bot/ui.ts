import { terminalSafe } from "./terminalSafe.ts";
import { createElement as h, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Box, Static, Text, render, useApp, useInput, useStdin } from "ink";
import { DdnetBot } from "./bot.ts";
import type { BotLine, BotStatus } from "./bot.ts";

type Row = { key: number; kind: BotLine["kind"] | "you" | "reply"; text: string; from?: string; at: string };

const INK = {
  dim: "#8f9aad",
  faint: "#6b7280",
  ink: "#e7eaf0",
  good: "#87af87",
  warn: "#d7af87",
  bad: "#d78787",
  accent: "#87a7af",
  whisper: "#afafd7",
};

function stamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

function line(row: Row): ReactElement {
  const time = h(Text, { color: INK.faint }, `${row.at} `);
  if (row.kind === "whisper") {
    return h(
      Text,
      { key: row.key },
      time,
      h(Text, { color: INK.whisper, bold: true }, `${row.from ?? "?"} → you  `),
      h(Text, { color: INK.whisper }, row.text),
    );
  }
  if (row.kind === "chat") {
    return h(Text, { key: row.key }, time, h(Text, { bold: true }, `${row.from ?? "?"}  `), h(Text, { color: INK.ink }, row.text));
  }
  if (row.kind === "you") {
    return h(Text, { key: row.key }, time, h(Text, { color: INK.good }, "you  "), h(Text, { color: INK.ink }, row.text));
  }
  if (row.kind === "reply") {
    return h(Text, { key: row.key }, time, h(Text, { color: INK.accent }, "bot  "), h(Text, { color: INK.dim }, row.text));
  }
  if (row.kind === "event") {
    return h(Text, { key: row.key }, time, h(Text, { color: INK.warn }, "·  "), h(Text, { color: INK.dim }, row.text));
  }
  return h(Text, { key: row.key, color: INK.faint }, `${row.at} ${row.text}`);
}

const LOUD = /error|refus|could not|failed|disconnect|connected|map change|clip saved|kill|stuck|frozen without|duel invitation|keeping up|keeps up/i;

function App({ bot, onQuit }: { bot: DdnetBot; onQuit: () => void }): ReactElement {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<BotStatus>(() => bot.status());
  const [note, setNote] = useState("");
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const [verbose, setVerbose] = useState(false);
  const app = useApp();

  const { isRawModeSupported } = useStdin();

  useEffect(() => {
    let key = 0;
    bot.onOutput((l) => {

      const text = terminalSafe(l.text);
      if (l.kind === "log" && !verbose && !LOUD.test(text)) {
        setNote(text);
        return;
      }
      setRows((prev) => [...prev, { key: key++, kind: l.kind, text, from: l.from === undefined ? undefined : terminalSafe(l.from), at: stamp() }]);
    });
    const timer = setInterval(() => setStatus(bot.status()), 300);
    return () => {
      bot.onOutput(null);
      clearInterval(timer);
    };
  }, [bot, verbose]);

  const push = (kind: Row["kind"], t: string): void =>
    setRows((prev) => [...prev, { key: prev.length + 1e6, kind, text: t, at: stamp() }]);

  const submit = (): void => {
    const entered = text.trim();
    setText("");
    setCursor(0);
    if (entered.length === 0) return;
    const low = entered.toLowerCase();
    if (low === "!log on" || low === "?log on") setVerbose(true);
    if (low === "!log off" || low === "?log off") setVerbose(false);
    try {
      const got = bot.handleConsole(entered) as string | Promise<string>;

      if (typeof got !== "string") {
        void got.then((reply) => { for (const r of reply.split("\n")) if (r.length > 0) push("reply", r); });
        return;
      }
      const reply = got;

      if (!entered.startsWith("!") && !entered.startsWith("?") && reply.length === 0) push("you", entered);
      for (const r of reply.split("\n")) if (r.length > 0) push("reply", r);
    } catch (err) {
      push("event", `error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      onQuit();
      app.exit();
      return;
    }
    if (key.return) return submit();
    if (key.leftArrow) return setCursor((c) => Math.max(0, c - 1));
    if (key.rightArrow) return setCursor((c) => Math.min(text.length, c + 1));
    if (key.backspace || key.delete) {
      if (cursor === 0) return;
      setText(`${text.slice(0, cursor - 1)}${text.slice(cursor)}`);
      setCursor((c) => c - 1);
      return;
    }
    if (key.escape || key.tab || key.upArrow || key.downArrow) return;
    if (input.length === 0) return;
    setText(`${text.slice(0, cursor)}${input}${text.slice(cursor)}`);
    setCursor((c) => c + input.length);
  }, { isActive: isRawModeSupported });

  const phase =
    status.phase === "online" ? (status.acting ? "playing" : "stopped") : status.phase === "connecting" ? "connecting" : "offline";
  const phaseColour = status.phase === "online" ? (status.acting ? INK.good : INK.warn) : INK.warn;
  const target =
    status.walk !== null ? status.walk : status.targetName === null ? "—" : `${terminalSafe(status.targetName)}${status.targetDist === null ? "" : ` ${status.targetDist}px`}`;

  const chip = (label: string, value: string, colour: string): ReactElement[] => [
    h(Text, { key: `${label}k`, color: INK.faint }, `  ${label} `),
    h(Text, { key: `${label}v`, color: colour }, value),
  ];

  return h(
    Box,
    { flexDirection: "column" },
    h(Static<Row>, { items: rows, children: (row: Row) => line(row) }),
    h(
      Box,
      { flexDirection: "column", borderStyle: "round", borderColor: INK.faint, paddingX: 1 },
      h(
        Box,
        { key: "status" },
        h(Text, { bold: true, color: INK.accent }, status.name),
        h(Text, { color: INK.faint }, `@${status.server}`),
        ...chip("brain", status.brain, INK.ink),
        ...chip("state", `${phase}${status.mode === "fight" ? "" : `·${status.mode}`}${status.frozen ? " · frozen" : ""}`, phaseColour),
        ...(status.wb ? chip("wb", status.wb.replace(/^WB /, ""), INK.ink) : []),
        ...(status.lowCpu === true ? chip("low CPU", "on", INK.ink) : []),
        ...(status.lag?.hint === true ? chip("PC", "behind", INK.warn) : []),
        ...chip("vs", target, status.targetName === null && status.walk === null ? INK.faint : INK.ink),
        ...chip("score", `${status.stats.kills}/${status.stats.deaths}`, INK.ink),
      ),
      status.offlineReason !== ""
        ? h(Box, { key: "why" }, h(Text, { color: INK.bad, wrap: "truncate-end" }, `offline: ${status.offlineReason}`))
        : note === ""
          ? null
          : h(Box, { key: "note" }, h(Text, { color: INK.faint, wrap: "truncate-end" }, note)),
      h(
        Box,
        { key: "input" },
        h(Text, { color: INK.accent }, "› "),
        h(Text, null, text.slice(0, cursor)),
        h(Text, { inverse: true }, text[cursor] ?? " "),
        h(Text, null, text.slice(cursor + 1)),
      ),
    ),
  );
}

export function startInkUi(bot: DdnetBot, onQuit: () => void): { stop: () => void } | null {
  if (process.stdin.isTTY !== true) return null;
  const instance = render(h(App, { bot, onQuit }), { exitOnCtrlC: false });
  return {
    stop: () => {
      bot.onOutput(null);
      instance.unmount();
    },
  };
}
