import { describe, expect, it } from "vitest";
import { DEFAULT_POINTS, pointsForRank, rankByScore } from "./points";

describe("rankByScore", () => {
  it("ranks ascending with 1-2-2-4 ties and skips nulls", () => {
    const rows = [
      { id: "a", s: 80 },
      { id: "b", s: 75 },
      { id: "c", s: 75 },
      { id: "d", s: 90 },
      { id: "e", s: null },
    ];
    const r = rankByScore(rows, (x) => x.s);
    expect(r.get(rows[1]!)).toBe(1);
    expect(r.get(rows[2]!)).toBe(1);
    expect(r.get(rows[0]!)).toBe(3);
    expect(r.get(rows[3]!)).toBe(4);
    expect(r.has(rows[4]!)).toBe(false);
  });
});

describe("pointsForRank", () => {
  it("top 5 = 3, top 10 = 2, top 15 = 1, else 0", () => {
    expect(pointsForRank(1)).toBe(3);
    expect(pointsForRank(5)).toBe(3);
    expect(pointsForRank(6)).toBe(2);
    expect(pointsForRank(10)).toBe(2);
    expect(pointsForRank(11)).toBe(1);
    expect(pointsForRank(15)).toBe(1);
    expect(pointsForRank(16)).toBe(0);
    expect(pointsForRank(null)).toBe(0);
  });
  it("team win 2, tie 1 defaults", () => {
    expect(DEFAULT_POINTS.pointsTeamWin).toBe(2);
    expect(DEFAULT_POINTS.pointsTeamTie).toBe(1);
  });
});
