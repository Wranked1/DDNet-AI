const HOMOGLYPH: Record<string, string> = {
  α: "a", ε: "e", ο: "o", ς: "c", χ: "x", κ: "k", ι: "i", ρ: "p", τ: "t", υ: "u", ν: "v", μ: "m",
  ᴀ: "a", ᴄ: "c", ᴇ: "e", ᴋ: "k", ᴏ: "o", ᴘ: "p", ᴛ: "t", ᴜ: "u", ᴠ: "v", ꜱ: "s",
  ɑ: "a", "℮": "e", "×": "x", ҳ: "x",
  "ꮯ": "c", "ꭺ": "a", "ꮪ": "s", "ꭼ": "e",
  ս: "u", օ: "o", ց: "g", հ: "h", ո: "n",
};

const MARK_CS = "\u0001";
const MARK_AE = "\u0002";
const MARK_PR = "\u0003";
const MARK_UY = "\u0004";
const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", ж: "zh", з: "z", и: "i", й: "i", к: "k", л: "l", м: "m", н: "n",
  о: "o", п: "p", т: "t", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "i", ь: "", ю: "yu",
  я: "ya", і: "i", ї: "i", є: "e", ґ: "g",
  с: MARK_CS, е: MARK_AE, э: MARK_AE, р: MARK_PR, у: MARK_UY,
};

const LEET: Record<string, string> = {
  "4": "a", "@": "a", "3": "e", "1": "i", "!": "i", "0": "o", "5": "s", "$": "s", "7": "t", "|": "l",
};

function fold(text: string): string {
  let s = "";
  for (const ch of text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()) {
    const h = HOMOGLYPH[ch] ?? ch;
    s += CYR[h] ?? LEET[h] ?? h;
  }

  s = s.replace(/[^a-z\u0001-\u0004]/g, "");

  s = s.replace(/ck[sc\u0001]/g, "x").replace(/k[sc\u0001]/g, "x").replace(/q/g, "c");

  return s.replace(/([a-z\u0001-\u0004])\1+/g, "$1");
}

const CASSEX = /[ck\u0001][a\u0002][scz\u0001]+[e\u0002]x/;
const CHEATS_SLIVKA = /ch[aeiy\u0002\u0004]{1,2}t[aeiouy\u0004]?[sc\u0001]* ?[sc\u0001]*l[iy][vw]k/;

function words(text: string): string[] {
  const groups: string[] = [];
  let single = false;
  for (const w of text.split(/\s+/)) {
    if (w === "") continue;
    const one = [...w].length === 1;
    if (one && single) groups[groups.length - 1] += w;
    else groups.push(w);
    single = one;
  }
  return groups.map(fold).filter((g) => g !== "");
}

const LOOKALIKE: Record<string, string> = {
  а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x", і: "i",
};
const OWN_CHANNEL = "aiddnet";

function plain(text: string): string {
  let s = "";
  for (const ch of text.normalize("NFKD").replace(/[\p{M}\p{Cf}]/gu, "").toLowerCase()) {
    const h = HOMOGLYPH[ch] ?? ch;
    s += LOOKALIKE[h] ?? h;
  }
  return s;
}

const SEP = String.raw`(?:\s*(?:[.,。．·•・_-]|[(\[{]\s*(?:\.|dot|toчka)\s*[)\]}]|dot|toчka)\s*|\s+|)`;

const LINK = new RegExp(String.raw`(?<![a-z0-9]|[a-z]['’])(?:t${SEP}me|telegram${SEP}(?:me|dog))\s*[\/\\]\s*(?:s\s*[\/\\]\s*)?([+a-z0-9_]+)`, "g");

function foreignTelegram(text: string): boolean {
  const s = plain(text);
  if (/tg\s*:\s*\/\s*\//.test(s)) return true;
  for (const m of s.matchAll(LINK)) {
    if (m[1] !== OWN_CHANNEL) return true;
  }
  for (const m of s.matchAll(/@([a-z0-9_]+)/g)) {
    const name = m[1];
    if (name.length < 5 || name.length > 32 || name === OWN_CHANNEL || name === `${OWN_CHANNEL}2`) continue;
    return true;
  }
  return false;
}

export function holdLine(text: string): boolean {
  const w = words(text);
  if (w.some((g) => CASSEX.test(g))) return true;
  if (CHEATS_SLIVKA.test(w.join(" "))) return true;
  return foreignTelegram(text);
}
