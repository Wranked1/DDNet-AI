const BLANK_DEFAULTS: Record<string, string> = { name: "AI-Tee", skin: "cammostripes" };

export function rememberedValue(saved: Record<string, unknown>, key: string, interactive: boolean = process.stdin.isTTY === true): string | undefined {
  const v = saved[key];
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return undefined;
  if (v.trim() === "" && key in BLANK_DEFAULTS) return interactive ? undefined : BLANK_DEFAULTS[key];
  return v;
}

export function parseServer(text: string): { host: string; port: number } {
  const at = text.lastIndexOf(":");
  if (at <= 0) return { host: text.trim(), port: 8303 };
  const raw = text.slice(at + 1).trim();
  const port = /^\d{1,5}$/.test(raw) ? Number(raw) : 0;
  return { host: text.slice(0, at).trim(), port: port >= 1 && port <= 65535 ? port : 8303 };
}
