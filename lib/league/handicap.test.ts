import { describe, expect, it } from "vitest";
import { DEFAULT_HANDICAP_SETTINGS, handicapForWeek, handicapFromHistory, sourceWeeksFor, strokesBack, throwOuts, weekLows } from "./handicap";

describe("strokesBack", () => {
  it("is gross minus the week low, floored at 0 and capped at 20", () => {
    expect(strokesBack(85, 72)).toBe(13);
    expect(strokesBack(72, 72)).toBe(0);
    expect(strokesBack(70, 72)).toBe(0);
    expect(strokesBack(110, 72)).toBe(20);
    expect(strokesBack(110, 72, 30)).toBe(30);
  });
});

describe("throwOuts", () => {
  it("drops one highest round for every 3 played, never all of them", () => {
    expect(throwOuts(1)).toBe(0);
    expect(throwOuts(2)).toBe(0);
    expect(throwOuts(3)).toBe(1);
    expect(throwOuts(5)).toBe(1);
    expect(throwOuts(6)).toBe(2);
    expect(throwOuts(9)).toBe(3);
    expect(throwOuts(3, 1)).toBe(2);
    expect(throwOuts(4, 0)).toBe(0);
  });
});

describe("handicapFromHistory", () => {
  it("averages strokes-back and rounds", () => {
    expect(handicapFromHistory([10, 12])).toEqual({ handicap: 11, roundsUsed: 2 });
    expect(handicapFromHistory([10, 13])).toEqual({ handicap: 12, roundsUsed: 2 });
  });
  it("throws out the highest every 3 rounds", () => {
    expect(handicapFromHistory([5, 6, 20])).toEqual({ handicap: 6, roundsUsed: 2 });
    expect(handicapFromHistory([5, 6, 20, 7, 8, 19])).toEqual({ handicap: 7, roundsUsed: 4 });
  });
  it("returns null with no rounds", () => {
    expect(handicapFromHistory([])).toBeNull();
  });
});

describe("sourceWeeksFor (2 opening weeks)", () => {
  it("opening weeks use the opening period retroactively", () => {
    expect(sourceWeeksFor(1)).toEqual([1, 2]);
    expect(sourceWeeksFor(2)).toEqual([1, 2]);
  });
  it("week 3 uses weeks 1-2, week 4 uses 1-3, progressive after", () => {
    expect(sourceWeeksFor(3)).toEqual([1, 2]);
    expect(sourceWeeksFor(4)).toEqual([1, 2, 3]);
    expect(sourceWeeksFor(7)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("handicapForWeek", () => {
  const scores = [
    { weekNumber: 1, gross: 82 },
    { weekNumber: 2, gross: 80 },
    { weekNumber: 3, gross: 79 },
  ];
  const lows = weekLows([
    { weekNumber: 1, gross: 70 },
    { weekNumber: 2, gross: 72 },
    { weekNumber: 3, gross: 71 },
    ...scores,
  ]);

  it("is straight (null) while the opening period is still open", () => {
    expect(handicapForWeek({ weekNumber: 1, playerScores: scores, lows, revealedWeeks: new Set([1]) })).toBeNull();
    expect(handicapForWeek({ weekNumber: 3, playerScores: scores, lows, revealedWeeks: new Set([1]) })).toBeNull();
  });

  it("applies the weeks 1-2 handicap retroactively to weeks 1-2 and to week 3 once week 2 closes", () => {
    const revealed = new Set([1, 2]);
    // strokes back: wk1 82-70=12, wk2 80-72=8 → avg 10
    expect(handicapForWeek({ weekNumber: 1, playerScores: scores, lows, revealedWeeks: revealed })).toEqual({ handicap: 10, roundsUsed: 2 });
    expect(handicapForWeek({ weekNumber: 2, playerScores: scores, lows, revealedWeeks: revealed })).toEqual({ handicap: 10, roundsUsed: 2 });
    expect(handicapForWeek({ weekNumber: 3, playerScores: scores, lows, revealedWeeks: revealed })).toEqual({ handicap: 10, roundsUsed: 2 });
  });

  it("week 4 uses weeks 1-3 (with the 3-round throw-out) once week 3 closes", () => {
    const revealed = new Set([1, 2, 3]);
    // strokes back 12, 8, 8 → drop the 12 → avg 8
    expect(handicapForWeek({ weekNumber: 4, playerScores: scores, lows, revealedWeeks: revealed })).toEqual({ handicap: 8, roundsUsed: 2 });
    // week 4 is not computable until week 3 closes
    expect(handicapForWeek({ weekNumber: 4, playerScores: scores, lows, revealedWeeks: new Set([1, 2]) })).toBeNull();
  });

  it("a new player with no source rounds has no handicap", () => {
    expect(handicapForWeek({ weekNumber: 4, playerScores: [{ weekNumber: 4, gross: 90 }], lows, revealedWeeks: new Set([1, 2, 3]) })).toBeNull();
  });

  it("respects the cap", () => {
    const r = handicapForWeek({ weekNumber: 3, playerScores: [{ weekNumber: 1, gross: 120 }, { weekNumber: 2, gross: 120 }], lows, revealedWeeks: new Set([1, 2]), settings: DEFAULT_HANDICAP_SETTINGS });
    expect(r).toEqual({ handicap: 20, roundsUsed: 2 });
  });
});
