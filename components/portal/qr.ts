/**
 * Minimal pure-TS QR code encoder (byte mode, error-correction level M,
 * versions 1–10, mask auto-selected). Enough for short payloads like
 * `tee24:member:<cuid>` (~35 chars → version 3). No dependencies.
 *
 * Returns a boolean matrix; `qrToSvg` renders it as an SVG string.
 */

// ── GF(256) arithmetic for Reed–Solomon ─────────────────────────────────────
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
})();
const gmul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]!;
      next[j + 1] ^= gmul(poly[j]!, EXP[i]!);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGenerator(ecLen);
  const res = new Uint8Array(ecLen);
  for (const d of data) {
    const factor = d ^ res[0]!;
    res.copyWithin(0, 1);
    res[ecLen - 1] = 0;
    for (let j = 0; j < ecLen; j++) res[j] ^= gmul(gen[j + 1]!, factor);
  }
  return res;
}

// ── Version tables (EC level M) ─────────────────────────────────────────────
// [total codewords, ec codewords per block, blocks group1, data cw group1, blocks group2, data cw group2]
const VERSIONS_M: [number, number, number, number, number, number][] = [
  [26, 10, 1, 16, 0, 0], // v1
  [44, 16, 1, 28, 0, 0],
  [70, 26, 1, 44, 0, 0],
  [100, 18, 2, 32, 0, 0],
  [134, 24, 2, 43, 0, 0],
  [172, 16, 4, 27, 0, 0],
  [196, 18, 4, 31, 0, 0],
  [242, 22, 2, 38, 2, 39],
  [292, 22, 3, 36, 2, 37],
  [346, 26, 4, 43, 1, 44], // v10
];
const ALIGN_POS: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

function dataCapacity(v: number) {
  const t = VERSIONS_M[v - 1]!;
  return t[2] * t[3] + t[4] * t[5];
}

export function encodeQr(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const cap = dataCapacity(v);
    const headerBits = 4 + (v <= 9 ? 8 : 16);
    if (Math.ceil((headerBits + bytes.length * 8) / 8) <= cap) {
      version = v;
      break;
    }
  }
  if (!version) throw new Error("QR payload too long for this encoder (max ~270 bytes)");

  const t = VERSIONS_M[version - 1]!;
  const size = version * 4 + 17;
  const capBytes = dataCapacity(version);

  // Bit stream: mode(0100) + count + data + terminator + pad
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const maxBits = capBytes * 8;
  push(0, Math.min(4, maxBits - bits.length));
  while (bits.length % 8) bits.push(0);
  const pads = [0xec, 0x11];
  for (let i = 0; bits.length < maxBits; i++) push(pads[i % 2]!, 8);
  const data = new Uint8Array(capBytes);
  for (let i = 0; i < capBytes; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j]!;
    data[i] = b;
  }

  // Split into blocks, compute EC, interleave
  const blocks: Uint8Array[] = [];
  const ecs: Uint8Array[] = [];
  let off = 0;
  for (let g = 0; g < 2; g++) {
    const count = g === 0 ? t[2] : t[4];
    const len = g === 0 ? t[3] : t[5];
    for (let i = 0; i < count; i++) {
      const blk = data.slice(off, off + len);
      off += len;
      blocks.push(blk);
      ecs.push(rsEncode(blk, t[1]));
    }
  }
  const out: number[] = [];
  const maxLen = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxLen; i++) for (const b of blocks) if (i < b.length) out.push(b[i]!);
  for (let i = 0; i < t[1]; i++) for (const e of ecs) out.push(e[i]!);

  // Matrix + function patterns
  const m: (boolean | null)[][] = Array.from({ length: size }, () => Array<boolean | null>(size).fill(null));
  const set = (r: number, c: number, v: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) m[r]![c] = v;
  };
  const finder = (r: number, c: number) => {
    for (let dr = -1; dr <= 7; dr++)
      for (let dc = -1; dc <= 7; dc++) {
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const ring = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const core = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        set(r + dr, c + dc, inOuter && (ring || core));
      }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const ap = ALIGN_POS[version - 1]!;
  for (const r of ap)
    for (const c of ap) {
      // Skip the three that would overlap finder patterns.
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  set(size - 8, 8, true); // dark module
  // Reserve format areas
  for (let i = 0; i < 8; i++) {
    if (m[8]![i] === null) m[8]![i] = false;
    if (m[i]![8] === null) m[i]![8] = false;
    if (m[8]![size - 1 - i] === null) m[8]![size - 1 - i] = false;
    if (m[size - 1 - i]![8] === null) m[size - 1 - i]![8] = false;
  }
  if (m[8]![8] === null) m[8]![8] = false;
  if (version >= 7) {
    // (not reached: we cap at v10 but v7+ needs version info; fill reserved area)
    const vinfo = VERSION_INFO[version]!;
    for (let i = 0; i < 18; i++) {
      const bit = ((vinfo >> i) & 1) === 1;
      m[Math.floor(i / 3)]![size - 11 + (i % 3)] = bit;
      m[size - 11 + (i % 3)]![Math.floor(i / 3)] = bit;
    }
  }

  // Place data (zigzag)
  const isFunc = m.map((row) => row.map((v) => v !== null));
  let bi = 0;
  const totalBits = out.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - vert : vert;
        if (isFunc[r]![c]) continue;
        let bit = false;
        if (bi < totalBits) {
          bit = ((out[bi >> 3]! >> (7 - (bi & 7))) & 1) === 1;
          bi++;
        }
        m[r]![c] = bit;
      }
    }
  }

  // Mask selection
  const MASKS: ((r: number, c: number) => boolean)[] = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (_r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];
  let best: boolean[][] = [];
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const grid = m.map((row, r) => row.map((v, c) => (isFunc[r]![c] ? Boolean(v) : Boolean(v) !== MASKS[mask]!(r, c))));
    applyFormat(grid, mask, size);
    const score = penalty(grid);
    if (score < bestScore) {
      bestScore = score;
      best = grid;
    }
  }
  return best;
}

const VERSION_INFO: Record<number, number> = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3 };

function applyFormat(grid: boolean[][], mask: number, size: number) {
  // EC level M = 00
  const data = (0b00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  const bitsVal = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number) => ((bitsVal >> i) & 1) === 1;
  // grid[row][col]. First copy: down column 8 then along row 8 (top-left).
  for (let i = 0; i <= 5; i++) grid[i]![8] = bit(i);
  grid[7]![8] = bit(6);
  grid[8]![8] = bit(7);
  grid[8]![7] = bit(8);
  for (let i = 9; i < 15; i++) grid[8]![14 - i] = bit(i);
  // Second copy: row 8 at the right edge, column 8 at the bottom edge.
  for (let i = 0; i < 8; i++) grid[8]![size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) grid[size - 15 + i]![8] = bit(i);
  grid[size - 8]![8] = true;
}

function penalty(g: boolean[][]): number {
  const n = g.length;
  let score = 0;
  const run = (get: (i: number, j: number) => boolean) => {
    for (let i = 0; i < n; i++) {
      let runLen = 1;
      for (let j = 1; j <= n; j++) {
        if (j < n && get(i, j) === get(i, j - 1)) runLen++;
        else {
          if (runLen >= 5) score += 3 + (runLen - 5);
          runLen = 1;
        }
      }
    }
  };
  run((i, j) => g[i]![j]!);
  run((i, j) => g[j]![i]!);
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) if (g[r]![c] === g[r]![c + 1] && g[r]![c] === g[r + 1]![c] && g[r]![c] === g[r + 1]![c + 1]) score += 3;
  let dark = 0;
  for (const row of g) for (const v of row) if (v) dark++;
  const pct = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

/** Render a matrix as a crisp SVG string (one <path>, quiet zone included). */
export function qrToSvg(matrix: boolean[][], opts: { size?: number; margin?: number; fg?: string; bg?: string } = {}): string {
  const n = matrix.length;
  const margin = opts.margin ?? 4;
  const total = n + margin * 2;
  const px = opts.size ?? 256;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (matrix[r]![c]) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${total}" height="${total}" fill="${opts.bg ?? "#fff"}"/><path d="${d}" fill="${opts.fg ?? "#000"}"/></svg>`;
}

export function qrSvgDataUrl(text: string, size = 256): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(qrToSvg(encodeQr(text), { size }))}`;
}
