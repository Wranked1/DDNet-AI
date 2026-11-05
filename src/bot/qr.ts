const VERSIONS: { total: number; ec: number; blocks: number }[] = [
  { total: 26, ec: 10, blocks: 1 },
  { total: 44, ec: 16, blocks: 1 },
  { total: 70, ec: 26, blocks: 1 },
  { total: 100, ec: 18, blocks: 2 },
  { total: 134, ec: 24, blocks: 2 },
  { total: 172, ec: 16, blocks: 4 },
];

const ALIGN: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];

export const QR_MAX_BYTES = 106;

function dataCodewords(version: number): number {
  const v = VERSIONS[version - 1];
  return v.total - v.ec * v.blocks;
}

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

export function rsRemainder(data: number[], degree: number): number[] {
  const divisor: number[] = new Array(degree).fill(0);
  divisor[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      divisor[j] = gfMul(divisor[j], root);
      if (j + 1 < degree) divisor[j] ^= divisor[j + 1];
    }
    root = gfMul(root, 2);
  }
  const result: number[] = new Array(degree).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    for (let i = 0; i < degree; i++) result[i] ^= gfMul(divisor[i], factor);
  }
  return result;
}

export function formatBits(mask: number): number {
  const data = mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

export function versionFor(length: number): number {
  for (let v = 1; v <= VERSIONS.length; v++) if (length <= dataCodewords(v) - 2) return v;
  throw new Error("text too long for the QR code");
}

function makeCodewords(bytes: Uint8Array, version: number): number[] {
  const cap = dataCodewords(version);
  const bits: number[] = [];
  const put = (value: number, n: number): void => {
    for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, 8);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, cap * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    data.push(b);
  }
  for (let pad = 0xec; data.length < cap; pad ^= 0xec ^ 0x11) data.push(pad);
  const v = VERSIONS[version - 1];
  const per = cap / v.blocks;
  const blocks: number[][] = [];
  const eccs: number[][] = [];
  for (let i = 0; i < v.blocks; i++) {
    const block = data.slice(i * per, (i + 1) * per);
    blocks.push(block);
    eccs.push(rsRemainder(block, v.ec));
  }
  const out: number[] = [];
  for (let i = 0; i < per; i++) for (const b of blocks) out.push(b[i]);
  for (let i = 0; i < v.ec; i++) for (const e of eccs) out.push(e[i]);
  return out;
}

export type QrMatrix = boolean[][];

export function encodeQr(text: string, mask?: number): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  const version = versionFor(bytes.length);
  const size = version * 4 + 17;
  const codewords = makeCodewords(bytes, version);

  const modules: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFn = (x: number, y: number, dark: boolean): void => {
    modules[y][x] = dark;
    fn[y][x] = true;
  };

  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }

  const finder = (cx: number, cy: number): void => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, dist !== 2 && dist !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);

  const pos = ALIGN[version - 1];
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  const drawFormat = (m: number): void => {
    const bits = formatBits(m);
    const bit = (i: number): boolean => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(i));
    setFn(8, 7, bit(6));
    setFn(8, 8, bit(7));
    setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(i));
    setFn(8, size - 8, true);
  };
  drawFormat(0);

  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fn[y][x] && bitIndex < codewords.length * 8) {
          modules[y][x] = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0;
          bitIndex++;
        }
      }
    }
  }

  const applyMask = (m: number): void => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let invert: boolean;
        switch (m) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        if (!fn[y][x] && invert) modules[y][x] = !modules[y][x];
      }
    }
  };

  let best = mask ?? 0;
  if (mask === undefined) {
    let bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m);
      drawFormat(m);
      const score = penalty(modules);
      if (score < bestScore) {
        bestScore = score;
        best = m;
      }
      applyMask(m);
    }
  }
  applyMask(best);
  drawFormat(best);
  return modules;
}

function penalty(m: boolean[][]): number {
  const n = m.length;
  let score = 0;
  for (const horizontal of [true, false]) {
    for (let a = 0; a < n; a++) {
      const at = (b: number): boolean => (horizontal ? m[a][b] : m[b][a]);
      let run = 1;
      for (let b = 1; b <= n; b++) {
        if (b < n && at(b) === at(b - 1)) run++;
        else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }

      for (let b = 0; b + 11 <= n; b++) {
        const w = (pat: number[]): boolean => pat.every((v, i) => at(b + i) === (v === 1));
        if (w([1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]) || w([0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1])) score += 40;
      }
    }
  }
  let dark = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (m[y][x]) dark++;
      if (x + 1 < n && y + 1 < n && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
    }
  }
  const total = n * n;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

export function qrSvg(text: string, px = 4): string {
  const m = encodeQr(text);
  const n = m.length + 8;
  let path = "";
  for (let y = 0; y < m.length; y++) for (let x = 0; x < m.length; x++) if (m[y][x]) path += `M${x + 4} ${y + 4}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${n * px}" height="${n * px}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
