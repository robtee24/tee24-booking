import { describe, expect, it } from "vitest";
import { DEFAULT_PAYOUTS, poolCents, splitPool, weeklyPayouts } from "./payouts";

const all = () => true;

describe("poolCents", () => {
  it("takes the percentage up to the cap", () => {
    expect(poolCents(10000, 50, 10000)).toBe(5000); // $100 pot → $50
    expect(poolCents(40000, 50, 10000)).toBe(10000); // $400 pot → capped at $100
    expect(poolCents(40000, 25, 5000)).toBe(5000); // 2nd capped at $50
    expect(poolCents(0, 50, 10000)).toBe(0);
  });
});

describe("splitPool", () => {
  it("splits equally across the 4 winner slots; ties share a slot", () => {
    const r = splitPool(10000, [
      { kind: "GROSS_1", playerIds: ["a"] },
      { kind: "NET_1", playerIds: ["b", "c"] },
      { kind: "TEAM_1", playerIds: ["d"] },
      { kind: "TEAM_1", playerIds: ["e"] },
    ], all);
    expect(r.lines).toEqual([
      { playerId: "a", kind: "GROSS_1", amountCents: 2500 },
      { playerId: "b", kind: "NET_1", amountCents: 1250 },
      { playerId: "c", kind: "NET_1", amountCents: 1250 },
      { playerId: "d", kind: "TEAM_1", amountCents: 2500 },
      { playerId: "e", kind: "TEAM_1", amountCents: 2500 },
    ]);
    expect(r.toChampionship).toBe(0);
  });
  it("ineligible (under 18) shares and empty slots roll to the championship pot", () => {
    const r = splitPool(10000, [
      { kind: "GROSS_1", playerIds: ["minor"] },
      { kind: "NET_1", playerIds: ["b"] },
      { kind: "TEAM_1", playerIds: [] },
      { kind: "TEAM_1", playerIds: [] },
    ], (id) => id !== "minor");
    expect(r.lines).toEqual([{ playerId: "b", kind: "NET_1", amountCents: 2500 }]);
    expect(r.toChampionship).toBe(7500);
  });
});

describe("weeklyPayouts", () => {
  it("20 players × $10: 1st $50 pool, 2nd $25 pool, $125 to championship", () => {
    const r = weeklyPayouts({
      potCents: 20000,
      settings: DEFAULT_PAYOUTS,
      first: { gross: ["g1"], net: ["n1"], team: ["t1a", "t1b"] },
      second: { gross: ["g2"], net: ["n2"], team: ["t2a", "t2b"] },
      eligible: all,
    });
    expect(r.firstPool).toBe(10000);
    expect(r.secondPool).toBe(5000);
    expect(r.paidOutCents).toBe(15000);
    expect(r.toChampionshipCents).toBe(5000);
    expect(r.lines.find((l) => l.playerId === "g1")?.amountCents).toBe(2500);
    expect(r.lines.find((l) => l.playerId === "t1a")?.amountCents).toBe(2500);
    expect(r.lines.find((l) => l.playerId === "g2")?.amountCents).toBe(1250);
  });
  it("caps the pools on a big pot and sends the rest to the championship", () => {
    const r = weeklyPayouts({
      potCents: 60000,
      settings: DEFAULT_PAYOUTS,
      first: { gross: ["g1"], net: ["n1"], team: ["t1a", "t1b"] },
      second: { gross: ["g2"], net: ["n2"], team: ["t2a", "t2b"] },
      eligible: all,
    });
    expect(r.firstPool).toBe(10000);
    expect(r.secondPool).toBe(5000);
    expect(r.toChampionshipCents).toBe(45000);
  });
  it("every cent is accounted for: paid + championship = pot", () => {
    const r = weeklyPayouts({
      potCents: 7000,
      settings: DEFAULT_PAYOUTS,
      first: { gross: ["g1", "g1b", "g1c"], net: [], team: ["t1a"] },
      second: { gross: ["g2"], net: ["n2"], team: [] },
      eligible: (id) => id !== "n2",
    });
    expect(r.paidOutCents + r.toChampionshipCents).toBe(7000);
  });
});
