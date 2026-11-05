import { createSocket } from "node:dgram";
import type { Socket } from "node:dgram";
import { isIPv6, SocketAddress } from "node:net";

export function canonIp(a: string): string {
  if (!isIPv6(a)) return a;
  const pct = a.indexOf("%");
  const bare = pct < 0 ? a : a.slice(0, pct);
  try {
    return new SocketAddress({ address: bare, family: "ipv6" }).address + (pct < 0 ? "" : a.slice(pct));
  } catch {
    return a;
  }
}

export function ip6Bytes(a: string): Buffer | null {
  if (!isIPv6(a)) return null;
  const pct = a.indexOf("%");
  const bare = pct < 0 ? a : a.slice(0, pct);
  let hex: string;
  try {

    hex = new URL(`http://[${bare}]/`).hostname.slice(1, -1);
  } catch {
    return null;
  }
  const cut = hex.indexOf("::");
  const part = (s: string): string[] => (s === "" ? [] : s.split(":"));
  const head = cut < 0 ? part(hex) : part(hex.slice(0, cut));
  const tail = cut < 0 ? [] : part(hex.slice(cut + 2));
  const zeros = cut < 0 ? 0 : 8 - head.length - tail.length;
  if (zeros < 0) return null;
  const groups = [...head, ...new Array<string>(zeros).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const out = Buffer.alloc(16);
  for (let i = 0; i < 8; i++) {
    if (!/^[0-9a-f]{1,4}$/i.test(groups[i])) return null;
    out.writeUInt16BE(Number.parseInt(groups[i], 16), i * 2);
  }
  return out;
}

export function mappedV4(a: string): string | null {
  const b = ip6Bytes(a);
  if (b === null) return null;
  for (let i = 0; i < 10; i++) if (b[i] !== 0) return null;
  if (b[10] !== 0xff || b[11] !== 0xff) return null;
  return `${b[12]}.${b[13]}.${b[14]}.${b[15]}`;
}

export function reachV6(address: string, port: number, timeoutMs = 2000): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    let timer: NodeJS.Timeout | undefined;
    let s: Socket | null = null;
    const codeOf = (e: unknown): string => (e instanceof Error ? ((e as NodeJS.ErrnoException).code ?? e.message) : String(e));
    const finish = (code: string | null): void => {
      if (done) return;
      done = true;
      if (timer !== undefined) clearTimeout(timer);
      if (s !== null) {
        s.removeAllListeners();
        s.on("error", () => {});
        try {
          s.close();
        } catch {

        }
      }
      resolve(code);
    };
    try {
      s = createSocket("udp6");

      s.on("error", (e: Error) => finish(codeOf(e)));
      timer = setTimeout(() => finish(null), timeoutMs);
      timer.unref();
      s.connect(port, address, (err?: Error) => finish(err === undefined || err === null ? null : codeOf(err)));
    } catch (e) {
      finish(codeOf(e));
    }
  });
}
