/**
 * GSPro scorecard reader.
 *
 * Input: OCR lines (text + bounding box) from the kiosk's Windows OCR pass over
 * the GSPro scorecard screen. Output: one row per player with 18 hole scores,
 * plus whatever round settings the screen shows (mulligans, gimmes, greens).
 *
 * The parser is layout-tolerant: it groups words into visual rows by their y
 * position, finds the hole header (1…9 OUT 10…18 IN TOT) to learn column
 * positions when it can, and otherwise reads the 18 numbers in order while
 * using OUT / IN / TOTAL cells to self-check. Parsing runs on the server so
 * it can be tuned against real screenshots without shipping a kiosk release.
 */

export type OcrLine = { text: string; x: number; y: number; w: number; h: number };

export type ParsedPlayerRow = {
  name: string;
  holes: number[]; // 18
  front9: number;
  back9: number;
  total: number;
  /** OUT/IN/TOT read from the card (null when absent) */
  outCell: number | null;
  inCell: number | null;
  totalCell: number | null;
  /** Sums agree with the OUT/IN/TOT cells that were present */
  consistent: boolean;
  rowY: number;
};

export type ParsedSettings = {
  mulligans: boolean | null; // true = on, false = off, null = not shown
  gimmeFt: number | null; // 0 = off, null = not shown
  gimmeOff: boolean | null;
  greens: string | null;
  raw: string[];
};

export type ParsedScorecard = {
  isScorecard: boolean;
  players: ParsedPlayerRow[];
  settings: ParsedSettings;
  par: number[] | null;
  warnings: string[];
  text: string[];
};

type Token = { text: string; cx: number; cy: number; x: number; y: number; w: number; h: number; num: number | null };

const RE_INT = /^\d{1,3}$/;
const RE_HOLE_HDR = /^(hole|holes|hole#|#)$/i;
const RE_OUT = /^(out|front|f9)$/i;
const RE_IN = /^(in|back|b9)$/i;
const RE_TOT = /^(tot|total|ttl|gross|score)$/i;
const RE_PAR = /^par$/i;
const RE_SKIP_ROW = /^(par|yds|yards|hdcp|hcp|handicap|index|si|net|putts|gir|fir|f\.i\.r|g\.i\.r|slope|rating|distance|meters|mtrs|m)$/i;

function tokenize(lines: OcrLine[]): Token[] {
  const out: Token[] = [];
  for (const l of lines) {
    const words = l.text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    // Spread words across the line's box proportionally to their length.
    const totalChars = words.reduce((s, w) => s + w.length, 0) + (words.length - 1);
    let cursor = 0;
    for (const w of words) {
      const frac0 = cursor / Math.max(totalChars, 1);
      const frac1 = (cursor + w.length) / Math.max(totalChars, 1);
      const x = l.x + l.w * frac0;
      const wPx = Math.max(1, l.w * (frac1 - frac0));
      const clean = w.replace(/[|]/g, "").trim();
      const numText = clean.replace(/[oO]/g, "0").replace(/[lI]/g, "1");
      const num = RE_INT.test(numText) ? Number(numText) : null;
      out.push({ text: clean, cx: x + wPx / 2, cy: l.y + l.h / 2, x, y: l.y, w: wPx, h: l.h, num });
      cursor += w.length + 1;
    }
  }
  return out;
}

/** Group tokens into visual rows by vertical overlap. */
function groupRows(tokens: Token[]): Token[][] {
  const sorted = [...tokens].sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  const rows: Token[][] = [];
  const medianH = median(sorted.map((t) => t.h)) || 20;
  for (const t of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0]!.cy - t.cy) <= medianH * 0.6) row.push(t);
    else rows.push([t]);
  }
  for (const r of rows) r.sort((a, b) => a.cx - b.cx);
  return rows;
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function sum(a: number[]) {
  return a.reduce((s, v) => s + v, 0);
}

/** The header row gives us x positions for holes 1-18 (+ OUT/IN/TOT) when GSPro draws one. */
function findHeader(rows: Token[][]): { holeX: number[]; outX: number | null; inX: number | null; totX: number | null; rowIndex: number } | null {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    const nums = row.filter((t) => t.num != null && t.num >= 1 && t.num <= 18);
    if (nums.length < 12) continue;
    // Must contain 1..9 ascending in x somewhere.
    const seq = nums.map((t) => t.num as number);
    let ok = 0;
    let expect = 1;
    const holeX: number[] = [];
    for (const t of nums) {
      if (t.num === expect) {
        holeX.push(t.cx);
        ok++;
        expect++;
      }
    }
    if (ok < 15) continue;
    // Fill gaps by interpolation if 1-2 holes are missing.
    while (holeX.length < 18 && holeX.length >= 2) {
      const step = (holeX[holeX.length - 1]! - holeX[0]!) / (holeX.length - 1);
      holeX.push(holeX[holeX.length - 1]! + step);
    }
    void seq;
    const outX = row.find((t) => RE_OUT.test(t.text))?.cx ?? null;
    const inX = row.find((t) => RE_IN.test(t.text))?.cx ?? null;
    const totX = row.find((t) => RE_TOT.test(t.text))?.cx ?? null;
    return { holeX, outX, inX, totX, rowIndex: r };
  }
  return null;
}

function readSettings(lines: OcrLine[]): ParsedSettings {
  const texts = lines.map((l) => l.text);
  const raw: string[] = [];
  let mulligans: boolean | null = null;
  let gimmeFt: number | null = null;
  let gimmeOff: boolean | null = null;
  let greens: string | null = null;

  const joined = texts.join(" \n ");
  const after = (re: RegExp) => {
    const m = re.exec(joined);
    return m ? joined.slice(m.index, m.index + 60) : null;
  };

  const mul = after(/mulligan[s]?/i);
  if (mul) {
    raw.push(mul.trim());
    if (/\b(off|none|no|disabled|0)\b/i.test(mul)) mulligans = false;
    else if (/\b(on|yes|enabled|unlimited|\d+\s*(per|\/)|\b[1-9]\d*\b)/i.test(mul.replace(/mulligan[s]?/i, ""))) mulligans = true;
  }
  const gim = after(/gimme[s]?|concede|auto\s*putt/i);
  if (gim) {
    raw.push(gim.trim());
    const ft = /(\d+(?:\.\d+)?)\s*(ft|feet|'|′)/i.exec(gim) ?? /(\d+)\s*(?=\b)/.exec(gim.replace(/gimme[s]?/i, ""));
    if (/\b(off|none|no|disabled)\b/i.test(gim)) {
      gimmeOff = true;
      gimmeFt = 0;
    } else if (ft) {
      gimmeFt = Number(ft[1]);
      gimmeOff = false;
    }
  }
  const grn = after(/green\s*(speed)?|stimp/i);
  if (grn) {
    raw.push(grn.trim());
    const m = /\b(slow|medium|normal|fast|very fast|tournament|\d{1,2}(?:\.\d)?)\b/i.exec(grn.replace(/green\s*(speed)?|stimp/i, ""));
    if (m) greens = m[1]!;
  }
  return { mulligans, gimmeFt, gimmeOff, greens, raw };
}

export function parseScorecard(lines: OcrLine[]): ParsedScorecard {
  const warnings: string[] = [];
  const text = lines.map((l) => l.text);
  const tokens = tokenize(lines);
  const rows = groupRows(tokens);
  const header = findHeader(rows);
  const players: ParsedPlayerRow[] = [];
  let par: number[] | null = null;

  for (let r = 0; r < rows.length; r++) {
    if (header && r === header.rowIndex) continue;
    const row = rows[r]!;
    const nums = row.filter((t) => t.num != null);
    if (nums.length < 15) continue;
    const words = row.filter((t) => t.num == null && !RE_HOLE_HDR.test(t.text) && !RE_OUT.test(t.text) && !RE_IN.test(t.text) && !RE_TOT.test(t.text));
    const label = words
      .filter((t) => t.cx < (nums[0]?.cx ?? Infinity))
      .map((t) => t.text)
      .join(" ")
      .trim();

    const isPar = RE_PAR.test(label) || (label === "" && !par && nums.every((t) => (t.num as number) >= 3 && (t.num as number) <= 5));
    if (isPar) {
      const holes = pickHoles(nums, header);
      if (holes) par = holes.holes;
      continue;
    }
    if (RE_SKIP_ROW.test(label.split(" ")[0] ?? "")) continue;
    if (!label) continue; // a numbers-only row that isn't par (yardages, handicap index)

    const picked = pickHoles(nums, header);
    if (!picked) continue;
    const { holes, outCell, inCell, totalCell } = picked;
    // Yardage / handicap-index rows contain values a golfer never shoots on a hole.
    if (holes.some((h) => h < 1 || h > 15)) continue;
    const front9 = sum(holes.slice(0, 9));
    const back9 = sum(holes.slice(9));
    const total = front9 + back9;
    const consistent = (outCell == null || outCell === front9) && (inCell == null || inCell === back9) && (totalCell == null || totalCell === total);
    players.push({ name: label, holes, front9, back9, total, outCell, inCell, totalCell, consistent, rowY: row[0]!.cy });
  }

  const settings = readSettings(lines);
  const isScorecard = players.length > 0 || !!header || /scorecard|score\s*card/i.test(text.join(" "));
  if (!header) warnings.push("No hole header row found; holes read in order.");
  for (const p of players) if (!p.consistent) warnings.push(`${p.name}: hole totals do not match the OUT/IN/TOTAL cells on the card.`);
  return { isScorecard, players, settings, par, warnings, text };
}

/** From a row's numeric tokens, pick 18 hole scores (+ OUT/IN/TOT cells). */
function pickHoles(nums: Token[], header: ReturnType<typeof findHeader>): { holes: number[]; outCell: number | null; inCell: number | null; totalCell: number | null } | null {
  if (header && header.holeX.length === 18) {
    const holes: number[] = [];
    const used = new Set<Token>();
    const colW = Math.abs(header.holeX[1]! - header.holeX[0]!) || 40;
    for (const hx of header.holeX) {
      let best: Token | null = null;
      for (const t of nums) {
        if (used.has(t)) continue;
        if (Math.abs(t.cx - hx) <= colW * 0.55 && (!best || Math.abs(t.cx - hx) < Math.abs(best.cx - hx))) best = t;
      }
      if (!best) return pickHolesInOrder(nums);
      used.add(best);
      holes.push(best.num as number);
    }
    const near = (x: number | null) => {
      if (x == null) return null;
      let best: Token | null = null;
      for (const t of nums) if (!used.has(t) && Math.abs(t.cx - x) <= colW * 0.7 && (!best || Math.abs(t.cx - x) < Math.abs(best.cx - x))) best = t;
      return best ? (best.num as number) : null;
    };
    return { holes, outCell: near(header.outX), inCell: near(header.inX), totalCell: near(header.totX) };
  }
  return pickHolesInOrder(nums);
}

/**
 * No header: read numbers left→right. Shapes we accept:
 *  18                 → holes only
 *  9 OUT 9 IN TOT     → 21 numbers
 *  9 OUT 9 IN         → 20
 *  9 9 TOT            → 19
 * The OUT/IN cells are detected as "equals the sum of the preceding nine".
 */
function pickHolesInOrder(nums: Token[]): { holes: number[]; outCell: number | null; inCell: number | null; totalCell: number | null } | null {
  const v = nums.map((t) => t.num as number);
  if (v.length < 18) return null;
  const front = v.slice(0, 9);
  let i = 9;
  let outCell: number | null = null;
  if (v[i] === sum(front) && v.length - i - 1 >= 9) {
    outCell = v[i]!;
    i++;
  }
  const back = v.slice(i, i + 9);
  if (back.length < 9) return null;
  i += 9;
  let inCell: number | null = null;
  let totalCell: number | null = null;
  if (i < v.length && v[i] === sum(back)) {
    inCell = v[i]!;
    i++;
  }
  if (i < v.length) totalCell = v[i]!;
  return { holes: [...front, ...back], outCell, inCell, totalCell };
}

/* ───────────── Course ───────────── */

/** Schedule slots whose course hasn't been announced ("Course TBA", "TBD", empty). */
export function isPlaceholderCourse(name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  return !n || /^(course\s*)?(tba|tbd)\b/i.test(n);
}

/** Words that GSPro course names add or drop freely ("Pebble Beach Golf Links" vs "Pebble Beach GL"). */
const COURSE_FILLER = new Set(["the", "golf", "links", "club", "course", "country", "cc", "gc", "gl", "resort", "and", "at", "of", "gsp", "gspro"]);

function courseWords(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
}

/** Levenshtein distance ≤ 1 (OCR drops or swaps the odd letter). */
function nearlyEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Does the screen show the expected course? Every significant word of the
 * scheduled name must appear on screen (long words may be one letter off), or
 * the words run together ("PebbleBeach").
 */
export function courseOnCard(expected: string, lines: OcrLine[] | string[]): boolean {
  const text = (lines as (OcrLine | string)[]).map((l) => (typeof l === "string" ? l : l.text)).join(" ");
  const all = courseWords(expected);
  const want = all.filter((w) => !COURSE_FILLER.has(w));
  const need = want.length ? want : all;
  if (!need.length) return false;
  const seen = courseWords(text);
  const squashed = seen.join("");
  if (squashed.includes(need.join(""))) return true;
  return need.every((w) => seen.some((s) => s === w || (w.length >= 5 && nearlyEqual(s, w))));
}

/* ───────────── Settings policy ───────────── */

export type SettingsCheck = { ok: boolean; hard: string[]; soft: string[] };

/**
 * Compare what the card shows to the league's required settings.
 *  - A setting that is visible and wrong is a hard failure (rejected).
 *  - A setting that is not visible on this screen is a soft warning (accepted, flagged for review).
 */
export function checkSettings(s: ParsedSettings, required: { mulligans: boolean; gimmeDistanceFt: number; greenSpeed?: string | null }): SettingsCheck {
  const hard: string[] = [];
  const soft: string[] = [];
  if (s.mulligans == null) soft.push("Mulligan setting not visible on this screen.");
  else if (s.mulligans !== required.mulligans) hard.push(required.mulligans ? "Mulligans must be ON." : "Mulligans must be turned OFF.");
  if (s.gimmeFt == null) soft.push("Gimme distance not visible on this screen.");
  else if (s.gimmeFt !== required.gimmeDistanceFt) hard.push(`Gimmes must be set to ${required.gimmeDistanceFt} ft (card shows ${s.gimmeOff ? "off" : `${s.gimmeFt} ft`}).`);
  if (required.greenSpeed) {
    if (s.greens == null) soft.push("Green speed not visible on this screen.");
    else if (s.greens.toLowerCase() !== required.greenSpeed.toLowerCase()) hard.push(`Greens must be ${required.greenSpeed} (card shows ${s.greens}).`);
  }
  return { ok: hard.length === 0, hard, soft };
}
