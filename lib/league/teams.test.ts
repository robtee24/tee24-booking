import { describe, expect, it } from "vitest";
import { bestBall, drawTeams, pairKey, playMatch } from "./teams";

const card = (n: number) => Array(18).fill(n) as number[];

describe("drawTeams", () => {
  it("pairs strongest with weakest and matches adjacent-strength teams", () => {
    const players = [
      { playerId: "p1", handicap: 0 },
      { playerId: "p2", handicap: 4 },
      { playerId: "p3", handicap: 8 },
      { playerId: "p4", handicap: 12 },
    ];
    const { teams, matches } = drawTeams(players);
    expect(teams).toHaveLength(2);
    expect(teams.map((t) => [t.player1Id, t.player2Id])).toEqual([["p1", "p4"], ["p2", "p3"]]);
    expect(matches).toEqual([{ team1: expect.any(Number), team2: expect.any(Number) }]);
  });
  it("avoids a repeat partner when another option exists", () => {
    const players = [
      { playerId: "p1", handicap: 0 },
      { playerId: "p2", handicap: 4 },
      { playerId: "p3", handicap: 8 },
      { playerId: "p4", handicap: 12 },
    ];
    const history = { partners: new Set([pairKey("p1", "p4")]), opponents: new Set<string>() };
    const { teams } = drawTeams(players, history);
    const t1 = teams.find((t) => t.player1Id === "p1")!;
    expect(t1.player2Id).not.toBe("p4");
  });
  it("odd roster: last player is solo and someone gets a bye with an odd team count", () => {
    const { teams, matches } = drawTeams([
      { playerId: "a", handicap: 1 },
      { playerId: "b", handicap: 2 },
      { playerId: "c", handicap: 3 },
    ]);
    expect(teams).toHaveLength(2);
    expect(teams.some((t) => t.player2Id === null)).toBe(true);
    expect(matches).toHaveLength(1);
  });
  it("uses the average handicap for players without one", () => {
    const { teams } = drawTeams([
      { playerId: "a", handicap: 0 },
      { playerId: "b", handicap: null },
      { playerId: "c", handicap: 20 },
      { playerId: "d", handicap: 10 },
    ]);
    expect(teams).toHaveLength(2);
  });
});

describe("bestBall / playMatch", () => {
  it("takes the lower score on each hole", () => {
    const bb = bestBall([card(5), card(4)]);
    expect(bb.every((h) => h === 4)).toBe(true);
  });
  it("one player without a card still gives the team a ball", () => {
    const bb = bestBall([card(5), null]);
    expect(bb.every((h) => h === 5)).toBe(true);
  });
  it("counts holes won; more holes wins", () => {
    const t1 = [[...Array(10).fill(4), ...Array(8).fill(6)] as number[]];
    const t2 = [card(5)];
    const r = playMatch(t1, t2);
    expect(r).toEqual({ team1Holes: 10, team2Holes: 8, winner: 1, outcome: "PLAYED" });
  });
  it("ties are ties", () => {
    const r = playMatch([card(4)], [card(4)]);
    expect(r.outcome).toBe("TIE");
    expect(r.winner).toBeNull();
  });
  it("forfeits and byes", () => {
    expect(playMatch([null, null], [card(4)]).outcome).toBe("FORFEIT_T1");
    expect(playMatch([card(4)], [null]).outcome).toBe("FORFEIT_T2");
    expect(playMatch([null], [null]).outcome).toBe("DOUBLE_FORFEIT");
    expect(playMatch([card(4)], null)).toEqual({ team1Holes: 0, team2Holes: 0, winner: 1, outcome: "BYE" });
  });
});
