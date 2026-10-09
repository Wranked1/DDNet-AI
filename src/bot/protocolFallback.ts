export const FALLBACK_PROTOCOL_VERSION = 20000;
export const FALLBACK_CLIENT_VERSION = { version: FALLBACK_PROTOCOL_VERSION, release_version: "20.0" };

export function asksForNewerClient(reason: string): boolean {
  const lower = reason.toLowerCase();
  return lower.includes("update your client") || lower.includes("slots support is required");
}

export function fallsBackOnDrop(reason: string, fromServer: boolean, announced: number, chosen: number | undefined): boolean {
  return fromServer && chosen === undefined && announced < FALLBACK_PROTOCOL_VERSION && asksForNewerClient(reason);
}
