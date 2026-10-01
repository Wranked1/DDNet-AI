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
