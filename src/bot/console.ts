import * as readline from "node:readline";
import { DdnetBot } from "./bot.ts";
import type { BotLine, BotStatus } from "./bot.ts";
import { Mascot, moodFrom } from "./mascot.ts";
import { terminalSafe } from "./terminalSafe.ts";

const ESC = "\x1b[";
const C = {
  reset: `${ESC}0m`,
  dim: `${ESC}2m`,
  bold: `${ESC}1m`,

  red: `${ESC}38;5;174m`,
  green: `${ESC}38;5;108m`,
  yellow: `${ESC}38;5;180m`,
  blue: `${ESC}38;5;109m`,
  grey: `${ESC}38;5;245m`,
  invert: `${ESC}7m`,
  faint: `${ESC}38;5;242m`,

  barKey: `${ESC}38;5;103m`,
  barVal: `${ESC}38;5;250m`,
  barWarn: `${ESC}38;5;180m`,
  barGood: `${ESC}38;5;108m`,
  whisper: `${ESC}38;5;146m`,

  barBg: `${ESC}48;5;236m`,
  barDim: `${ESC}48;5;236m${ESC}38;5;245m`,
  barTint: `${ESC}48;5;236m${ESC}38;5;109m`,
};

const LOUD = /error|refus|could not|failed|disconnect|connected|map change|clip saved|kill|stuck|frozen without/i;

const PROMPT = `${C.blue}\u203a${C.reset} `;

const HEADER_ROWS = 1;
const setScrollRegion = (rows: number): string => `${ESC}${HEADER_ROWS + 1};${rows}r`;
const RESET_SCROLL_REGION = `${ESC}r`;
const SAVE_CURSOR = "\x1b7";
const RESTORE_CURSOR = "\x1b8";
const CLEAR_LINE = `${ESC}2K`;

const PROMPT_WIDTH = 2;

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function stamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

export class BotConsole {
  private readonly rl: readline.Interface;
  private readonly bot: DdnetBot;
  private readonly onQuit: () => void;
  private statusTimer: NodeJS.Timeout | null = null;
  private lastStatus = "";
  private closed = false;
  private readonly mascot = new Mascot();
  private ticks = 0;
  private lastKills = 0;
  private lastNote = "";
  private verbose = false;
  private pinned = false;
  private onResize: (() => void) | null = null;
  private lastDeaths = 0;

  constructor(bot: DdnetBot, onQuit: () => void) {
    this.bot = bot;
    this.onQuit = onQuit;
    this.rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: PROMPT });
  }

  start(): void {
    this.pin();
    this.banner();
    this.bot.onOutput((line) => this.print(line));
    this.rl.prompt();

    this.rl.on("line", (raw) => {
      const line = raw.trim();
      if (line.length > 0) {
        try {

          const low = line.toLowerCase();
          if (low === "!log on" || low === "?log on") this.verbose = true;
          if (low === "!log off" || low === "?log off") this.verbose = false;
          const reply = this.bot.handleConsole(line);

          if (!line.startsWith("?") && reply.length === 0) {
            this.write(`${C.dim}${stamp()}${C.reset} ${C.green}you →${C.reset} ${line}`);
          }
          if (reply.length > 0) {
            for (const l of reply.split("\n")) this.write(`${C.dim}${stamp()}${C.reset} ${C.yellow}bot${C.reset}   ${l}`);
          }
        } catch (err) {
          this.write(`${C.red}error: ${err instanceof Error ? err.message : String(err)}${C.reset}`);
        }
      }

      if (!this.closed) this.rl.prompt();
    });

    this.rl.on("SIGINT", () => {
      this.onQuit();
    });

    this.rl.on("close", () => {
      const wasOpen = !this.closed;
      this.closed = true;
      if (this.statusTimer !== null) {
        clearInterval(this.statusTimer);
        this.statusTimer = null;
      }
      this.unpin();

      if (wasOpen) process.stdout.write(`\n${C.dim}console closed${C.reset}\n`);
    });

    this.statusTimer = setInterval(() => this.drawStatus(), 500);
  }

  private pin(): void {
    if (process.stdout.isTTY !== true) return;
    const rows = process.stdout.rows ?? 24;
    if (rows < 6) return;
    this.pinned = true;

    process.stdout.write(`${setScrollRegion(rows)}${ESC}${rows};1H`);
    this.onResize = () => {
      if (this.closed || !this.pinned) return;
      const now = process.stdout.rows ?? 24;
      process.stdout.write(setScrollRegion(now));
      this.drawStatus();
    };
    process.stdout.on("resize", this.onResize);
  }

  private unpin(): void {
    if (!this.pinned) return;
    this.pinned = false;
    if (this.onResize !== null) process.stdout.off("resize", this.onResize);
    this.onResize = null;
    process.stdout.write(`${RESET_SCROLL_REGION}\n`);
  }

  private banner(): void {
    const w = Math.min(process.stdout.columns ?? 80, 76);
    const rule = `${C.faint}${"\u2500".repeat(w)}${C.reset}`;
    process.stdout.write(
      [
        "",
        `  ${C.bold}ddnet-ai${C.reset}  ${C.faint}\u0431\u043e\u0442 \u0434\u043b\u044f DDNet${C.reset}`,
        "",
        `  ${C.barVal}\u0442\u0435\u043a\u0441\u0442${C.reset}  ${C.faint}\u0441\u043a\u0430\u0437\u0430\u0442\u044c \u0432 \u0438\u0433\u0440\u043e\u0432\u043e\u0439 \u0447\u0430\u0442${C.reset}`,
        `  ${C.blue}!help${C.reset}   ${C.faint}\u043a\u043e\u043c\u0430\u043d\u0434\u044b   \u00b7   ctrl+c \u2014 \u0432\u044b\u0445\u043e\u0434${C.reset}`,
        rule,
        "",
      ].join("\n"),
    );
  }

  private print(raw: BotLine): void {

    const line: BotLine = { ...raw, text: terminalSafe(raw.text), from: raw.from === undefined ? undefined : terminalSafe(raw.from) };
    if (line.kind === "whisper") {

      this.write(`${C.dim}${stamp()}${C.reset} ${C.whisper}${C.bold}[${line.from ?? "?"} → you]${C.reset} ${C.whisper}${line.text}${C.reset}`);
      return;
    }
    if (line.kind === "chat") {
      this.write(`${C.dim}${stamp()}${C.reset} ${C.bold}<${line.from ?? "?"}>${C.reset} ${line.text}`);
      return;
    }
    if (line.kind === "event") {
      this.write(`${C.dim}${stamp()}${C.reset} ${C.yellow}·${C.reset} ${line.text}`);
      return;
    }

    if (this.verbose || LOUD.test(line.text)) {
      this.write(`${C.dim}${stamp()} ${line.text}${C.reset}`);
      return;
    }
    this.lastNote = line.text;
  }

  private write(text: string, isStatus = false): void {
    if (this.closed) return;

    if (isStatus && this.pinned) {
      const cols = process.stdout.columns ?? 80;
      process.stdout.write(`${SAVE_CURSOR}${ESC}1;1H${CLEAR_LINE}${this.fit(text, cols)}${RESTORE_CURSOR}`);
      return;
    }

    const cols = process.stdout.columns ?? 80;
    const used = PROMPT_WIDTH + this.rl.line.length;
    const rows = cols > 0 ? Math.floor(used / cols) : 0;
    if (rows > 0) readline.moveCursor(process.stdout, 0, -rows);
    readline.cursorTo(process.stdout, 0);
    readline.clearScreenDown(process.stdout);
    process.stdout.write(`${text}\n`);
    this.rl.prompt(true);
  }

  private fit(text: string, cols: number): string {
    if (stripAnsi(text).length <= cols) return text;
    let out = "";
    let width = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\x1b") {
        const end = text.indexOf("m", i);
        if (end < 0) break;
        out += text.slice(i, end + 1);
        i = end;
        continue;
      }
      if (width >= cols - 1) break;
      out += text[i];
      width++;
    }
    return `${out}${C.reset}`;
  }

  private drawStatus(): void {
    if (this.closed) return;
    const s = this.bot.status();
    this.lastKills = s.stats.kills;
    this.lastDeaths = s.stats.deaths;
    const text = this.statusText(s);

    if (text === this.lastStatus) return;
    this.lastStatus = text;
    this.write(text, true);
  }

  private statusText(s: BotStatus): string {
    const cols = process.stdout.columns ?? 80;
    const sep = `${C.barBg}${C.faint} \u00b7 ${C.reset}${C.barBg}`;
    const phase =
      s.phase === "online" ? (s.acting ? "playing" : "stopped") : s.phase === "connecting" ? "connecting" : "offline";
    const phaseColour = s.phase === "online" ? (s.acting ? C.barGood : C.barWarn) : C.barWarn;

    const target =
      s.walk !== null
        ? s.walk
        : s.targetName === null
          ? "\u2014"
          : `${terminalSafe(s.targetName)}${s.targetDist === null ? "" : ` ${s.targetDist}px`}`;

    const left = [
      `${C.barBg}${C.bold} ddnet-ai${C.reset}${C.barBg}`,
      `${C.barTint}${s.name}${C.barDim}@${s.server}${C.reset}${C.barBg}`,
      `${C.barBg}${C.barKey}${s.brain}${C.reset}${C.barBg}`,
      `${C.barBg}${phaseColour}${phase}${s.mode === "fight" ? "" : `\u00b7${s.mode}`}${C.reset}${C.barBg}`,
      s.frozen ? `${C.barBg}${C.barWarn}frozen${C.reset}${C.barBg}` : "",
      `${C.barDim}vs${C.reset}${C.barBg} ${C.barVal}${target}${C.reset}${C.barBg}`,
    ]
      .filter((x) => x !== "")
      .join(sep);

    const score = `${C.barGood}${s.stats.kills}${C.barDim}/${C.barWarn}${s.stats.deaths}${C.reset}${C.barBg}`;

    const shown = s.offlineReason !== "" ? s.offlineReason : this.lastNote;
    const note = shown === "" ? "" : `${s.offlineReason !== "" ? C.barBg + C.barWarn : C.barDim}${shown}${C.reset}${C.barBg}  `;
    const right = `${note}${score} `;

    const pad = Math.max(1, cols - stripAnsi(left).length - stripAnsi(right).length);
    return `${C.barBg}${left}${" ".repeat(pad)}${right}${C.reset}`;
  }

  stop(): void {

    if (this.closed) return;
    this.closed = true;
    if (this.statusTimer !== null) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
    this.unpin();
    this.rl.close();
  }
}
