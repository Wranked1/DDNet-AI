export type DuelEnd = {

  other: string;

  ours: number;
  theirs: number;

  how: "won" | "left";
};

const PHRASE = " a 1vs1 round against '";
const DIGITS = /^\d{1,6}$/;

export function parseDuelEnd(clientId: number, text: string, ownNames: readonly string[]): DuelEnd | null {
  if (clientId !== -1 || typeof text !== "string") return null;
  const at = text.indexOf(PHRASE);
  if (at < 0 || text.indexOf(PHRASE, at + 1) >= 0) return null;
  const head = text.slice(0, at);
  const how = head.endsWith("' won") ? "won" : head.endsWith("' left") ? "left" : null;
  if (how === null || !text.startsWith("'")) return null;
  const tail = how === "won" ? "'! Final scores: " : "'! Current scores: ";
  const t = text.lastIndexOf(tail);
  if (t < at + PHRASE.length) return null;
  const scores = text.slice(t + tail.length).split(" - ");
  if (scores.length !== 2 || !DIGITS.test(scores[0]) || !DIGITS.test(scores[1])) return null;
  const first = text.slice(1, at - how.length - 2);
  const second = text.slice(at + PHRASE.length, t);
  if (first === "" || second === "") return null;
  const n = Number(scores[0]);
  const m = Number(scores[1]);
  const own = ownNames.filter((x) => x !== "");
  const weFirst = own.includes(first);
  const weSecond = own.includes(second);
  if (weFirst === weSecond) return null;
  return weFirst ? { other: second, ours: n, theirs: m, how } : { other: first, ours: m, theirs: n, how };
}
