import { describe, expect, it } from "vitest";
import { checkSettings, courseOnCard, isPlaceholderCourse, parseScorecard, type OcrLine } from "./ocr";
import { bestNameMatch } from "./names";

/** Build OCR lines for a GSPro-style card: header row, par row, player rows, settings footer. */
function cardLines(players: { name: string; holes: number[] }[], opts: { par?: number[]; settings?: string[] } = {}): OcrLine[] {
  const lines: OcrLine[] = [];
  const cols = ["HOLE", ...Array.from({ length: 9 }, (_, i) => String(i + 1)), "OUT", ...Array.from({ length: 9 }, (_, i) => String(i + 10)), "IN", "TOT"];
  let y = 100;
  lines.push({ text: cols.join(" "), x: 100, y, w: 1400, h: 24 });
  y += 40;
  if (opts.par) {
    const f = opts.par.slice(0, 9).reduce((a, b) => a + b, 0);
    const b = opts.par.slice(9).reduce((a, b) => a + b, 0);
    lines.push({ text: ["PAR", ...opts.par.slice(0, 9), f, ...opts.par.slice(9), b, f + b].join(" "), x: 100, y, w: 1400, h: 24 });
    y += 40;
  }
  for (const p of players) {
    const f = p.holes.slice(0, 9).reduce((a, b) => a + b, 0);
    const b = p.holes.slice(9).reduce((a, b) => a + b, 0);
    lines.push({ text: [p.name, ...p.holes.slice(0, 9), f, ...p.holes.slice(9), b, f + b].join(" "), x: 100, y, w: 1400, h: 24 });
    y += 40;
  }
  for (const s of opts.settings ?? []) {
    lines.push({ text: s, x: 100, y, w: 600, h: 20 });
    y += 30;
  }
  return lines;
}

const H = (front: number, back: number) => [...Array(9).fill(front), ...Array(9).fill(back)] as number[];
const PAR = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4];

describe("parseScorecard", () => {
  it("reads players, holes, totals and par from a header card", () => {
    const lines = cardLines([{ name: "Rob G", holes: H(4, 5) }, { name: "Alex", holes: H(5, 5) }], { par: PAR, settings: ["Mulligans: Off", "Gimmes: 10 ft", "Green Speed: Normal"] });
    const r = parseScorecard(lines);
    expect(r.isScorecard).toBe(true);
    expect(r.players.map((p) => p.name)).toEqual(["Rob G", "Alex"]);
    expect(r.players[0]!.front9).toBe(36);
    expect(r.players[0]!.back9).toBe(45);
    expect(r.players[0]!.total).toBe(81);
    expect(r.players[0]!.consistent).toBe(true);
    expect(r.players[1]!.total).toBe(90);
    expect(r.par).toEqual(PAR);
    expect(r.settings.mulligans).toBe(false);
    expect(r.settings.gimmeFt).toBe(10);
    expect(r.settings.greens?.toLowerCase()).toBe("normal");
  });

  it("flags inconsistent totals and reads cards without a header row", () => {
    const holes = H(4, 4);
    const lines: OcrLine[] = [{ text: ["Sam", ...holes.slice(0, 9), 36, ...holes.slice(9), 36, 99].join(" "), x: 0, y: 0, w: 1000, h: 20 }];
    const r = parseScorecard(lines);
    expect(r.players).toHaveLength(1);
    expect(r.players[0]!.total).toBe(72);
    expect(r.players[0]!.totalCell).toBe(99);
    expect(r.players[0]!.consistent).toBe(false);
    expect(r.warnings.some((w) => /do not match/.test(w))).toBe(true);
  });

  it("detects mulligans ON", () => {
    const r = parseScorecard(cardLines([{ name: "Rob", holes: H(4, 4) }], { settings: ["Mulligans: 3 per round"] }));
    expect(r.settings.mulligans).toBe(true);
  });

  it("is not a scorecard when there are no player rows", () => {
    const r = parseScorecard([{ text: "Main Menu", x: 0, y: 0, w: 100, h: 20 }, { text: "Play Golf", x: 0, y: 30, w: 100, h: 20 }]);
    expect(r.isScorecard).toBe(false);
    expect(r.players).toHaveLength(0);
  });
});

describe("checkSettings", () => {
  const required = { mulligans: false, gimmeDistanceFt: 10 };
  it("passes when the card shows mulligans off and 10 ft gimmes", () => {
    const c = checkSettings({ mulligans: false, gimmeFt: 10, gimmeOff: false, greens: "Normal", raw: [] }, required);
    expect(c.ok).toBe(true);
    expect(c.hard).toEqual([]);
  });
  it("hard-fails on mulligans on or wrong gimmes", () => {
    expect(checkSettings({ mulligans: true, gimmeFt: 10, gimmeOff: false, greens: null, raw: [] }, required).hard).toEqual(["Mulligans must be turned OFF."]);
    const g = checkSettings({ mulligans: false, gimmeFt: 6, gimmeOff: false, greens: null, raw: [] }, required);
    expect(g.ok).toBe(false);
    expect(g.hard[0]).toMatch(/Gimmes must be set to 10 ft/);
  });
  it("soft-warns when a setting is not visible", () => {
    const c = checkSettings({ mulligans: null, gimmeFt: null, gimmeOff: null, greens: null, raw: [] }, required);
    expect(c.ok).toBe(true);
    expect(c.soft).toHaveLength(2);
  });
});

describe("bestNameMatch", () => {
  const cands = [{ names: ["Rob G", "Robert Gilliam"] }, { names: ["Alex P", "Alex Park"] }, { names: ["Sam T"] }];
  it("matches typed names to card names loosely", () => {
    expect(bestNameMatch("rob g", cands, (c) => c.names)?.match).toBe(cands[0]);
    expect(bestNameMatch("Alex Park", cands, (c) => c.names)?.match).toBe(cands[1]);
    expect(bestNameMatch("ROB  G.", cands, (c) => c.names)?.match).toBe(cands[0]);
  });
  it("returns null when nothing is close", () => {
    expect(bestNameMatch("Zelda Q", cands, (c) => c.names)).toBeNull();
  });
});

describe("course check", () => {
  it("treats TBA / TBD / empty as placeholders", () => {
    expect(isPlaceholderCourse("Course TBA")).toBe(true);
    expect(isPlaceholderCourse("TBD")).toBe(true);
    expect(isPlaceholderCourse("")).toBe(true);
    expect(isPlaceholderCourse(null)).toBe(true);
    expect(isPlaceholderCourse("Pebble Beach")).toBe(false);
  });
  it("finds the scheduled course however GSPro spells it", () => {
    expect(courseOnCard("Pebble Beach", ["Pebble Beach Golf Links - Blue Tees", "1 2 3"])).toBe(true);
    expect(courseOnCard("Pebble Beach", ["PEBBLE BEACH GL"])).toBe(true);
    expect(courseOnCard("Pebble Beach", ["PebbleBeach_GSP"])).toBe(true);
    expect(courseOnCard("Pebble Beach", ["Pebb1e Beach"])).toBe(true);
    expect(courseOnCard("Pebble Beach Golf Links", ["Pebble Beach"])).toBe(true);
  });
  it("rejects a different course", () => {
    expect(courseOnCard("Pebble Beach", ["Bootleggers"])).toBe(false);
    expect(courseOnCard("Pebble Beach", ["Spyglass Hill", "Beach Road"])).toBe(false);
    expect(courseOnCard("Pebble Beach", [])).toBe(false);
  });
});
