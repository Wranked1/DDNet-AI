import { createRequire } from "node:module";

const MAX_DECOMPRESSED = 1 << 16;

const EOF_SYMBOL = 256;
const LUTBITS = 10;
const LUTMASK = (1 << LUTBITS) - 1;

type HuffmanNode = { numbits: number; symbol: number; left: number; right: number };
type HuffmanInternals = { nodes: HuffmanNode[]; decode_lut: number[] };

export class NetDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetDecodeError";
  }
}

let patched = false;

export function patchHuffman(): boolean {
  if (patched) return true;
  try {
    const require = createRequire(import.meta.url);
    const mod = require("teeworlds/lib/huffman.js") as { Huffman?: { prototype: Record<string, unknown> } };
    const proto = mod.Huffman?.prototype;
    if (proto === undefined || typeof proto.decompress !== "function") return false;

    proto.decompress = function bounded(this: HuffmanInternals, inp: Uint8Array, size = 0): Buffer {
      const nodes = this.nodes;
      const lut = this.decode_lut;
      const eof = nodes[EOF_SYMBOL];
      const src = size === 0 ? inp : inp.subarray(0, size);
      const end = src.length;
      const out: number[] = [];
      let bits = 0;
      let bitcount = 0;
      let srcIndex = 0;
      for (;;) {
        let nodeIndex = -1;
        if (bitcount >= LUTBITS) nodeIndex = lut[bits & LUTMASK];
        while (bitcount < 24 && srcIndex !== end) {
          bits |= src[srcIndex] << bitcount;
          bits >>>= 0;
          bitcount += 8;
          srcIndex++;
        }
        if (nodeIndex === -1) nodeIndex = lut[bits & LUTMASK];
        if (nodes[nodeIndex].numbits) {
          bits >>>= nodes[nodeIndex].numbits;
          bitcount -= nodes[nodeIndex].numbits;
        } else {
          bits >>>= LUTBITS;
          bitcount -= LUTBITS;
          for (;;) {
            nodeIndex = (bits & 1) !== 0 ? nodes[nodeIndex].right : nodes[nodeIndex].left;
            bitcount -= 1;
            bits >>>= 1;
            if (nodes[nodeIndex].numbits) break;
            if (bitcount === 0) throw new NetDecodeError("ran out of bits inside a symbol");
          }
        }
        if (nodes[nodeIndex] === eof) break;
        out.push(nodes[nodeIndex].symbol);

        if (out.length > MAX_DECOMPRESSED) {
          throw new NetDecodeError(`huffman produced over ${MAX_DECOMPRESSED} bytes from a ${end}-byte packet`);
        }

        if (srcIndex === end && bitcount <= 0) throw new NetDecodeError("packet ended without an end-of-file symbol");
      }
      return Buffer.from(out);
    };
    patched = true;
    return true;
  } catch {
    return false;
  }
}

const NET_PATTERNS = [/Invalid array length/i, /No more bits, decoding error/i, /huffman produced/i, /Invalid typed array length/i];

export function isNetworkDecodeError(err: unknown): boolean {
  if (err instanceof NetDecodeError) return true;
  const message = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
  if (!NET_PATTERNS.some((p) => p.test(message))) return false;

  return /teeworlds[\\/]lib[\\/]/.test(message) || err instanceof NetDecodeError;
}

export type NetGuard = { dropped: number; install(): void; uninstall(): void };

export function installNetworkGuard(onDrop: (message: string, dropped: number) => void): NetGuard {
  const guard: NetGuard = {
    dropped: 0,
    install(): void {
      process.on("uncaughtException", handler);
    },
    uninstall(): void {
      process.off("uncaughtException", handler);
    },
  };
  function handler(err: unknown): void {
    if (!isNetworkDecodeError(err)) throw err;
    guard.dropped++;
    onDrop(err instanceof Error ? err.message : String(err), guard.dropped);
  }
  return guard;
}
