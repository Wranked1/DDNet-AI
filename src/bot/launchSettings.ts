import { isIPv6 } from "node:net";

const BLANK_DEFAULTS: Record<string, string> = { name: "AI-Tee", skin: "cammostripes" };

export function rememberedValue(saved: Record<string, unknown>, key: string, interactive: boolean = process.stdin.isTTY === true): string | undefined {
  const v = saved[key];
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return undefined;
  if (v.trim() === "" && key in BLANK_DEFAULTS) return interactive ? undefined : BLANK_DEFAULTS[key];
  return v;
}

export function parseServer(text: string): { host: string; port: number } {
  const bracketed = /^\s*\[([^\]]*)\]\s*(?::(.*))?$/.exec(text);
  if (bracketed !== null) return { host: `[${bracketed[1].trim()}]`, port: portOr8303(bracketed[2] ?? "") };
  if (isIPv6(text.trim())) return { host: `[${text.trim()}]`, port: 8303 };

  if (text.split(":").length > 2) return { host: text.trim(), port: 8303 };
  const at = text.lastIndexOf(":");
  if (at <= 0) return { host: text.trim(), port: 8303 };
  return { host: text.slice(0, at).trim(), port: portOr8303(text.slice(at + 1)) };
}

function portOr8303(text: string): number {
  const raw = text.trim();
  const port = /^\d{1,5}$/.test(raw) ? Number(raw) : 0;
  return port >= 1 && port <= 65535 ? port : 8303;
}
