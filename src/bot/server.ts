import { holdLine } from "./chat.ts";

const FIRST_NICK = "@aiddnet";
const SECOND_NICK = "@aiddnet2";
const CLAN = "aiddnet";

export function nameOnServer(name: string, second = false): string {
  return holdLine(name) ? (second ? SECOND_NICK : FIRST_NICK) : name;
}

export function clanOnServer(clan: string): string {
  return holdLine(clan) ? CLAN : clan;
}

function fitBytes(text: string, n: number): string {
  let out = "";
  let used = 0;
  for (const ch of text) {
    const b = Buffer.byteLength(ch, "utf8");
    if (used + b > n) break;
    out += ch;
    used += b;
  }
  return out;
}

export function dummyNick(name: string, given = ""): string {
  const nick = fitBytes(given.trim() || `${fitBytes(name, 14)}2`, 15);
  return nick === name ? `${fitBytes(name, 14)}${name.endsWith("2") ? "3" : "2"}` : nick;
}
