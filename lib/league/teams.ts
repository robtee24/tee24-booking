/**
 * Weekly teams + best-ball match play.
 *
 * Teams are re-drawn every week after the deadline. Pairing goal: every match
 * is as even as possible. Players are sorted by handicap (unknown → league
 * average), paired strongest-with-weakest so team sums are flat, then teams
 * with the closest combined handicap play each other. A history penalty keeps
 * the same two people from being partners / opponents week after week.
 */

export type Pairable = { playerId: string; handicap: number | null };
export type TeamDraft = { teamNumber: number; player1Id: string; player2Id: string | null; strength: number };
export type MatchDraft = { team1: number; team2: number | null };

type History = { partners: Set<string>; opponents: Set<string> };

const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function pairKey(a: string, b: string) {
  return key(a, b);
}

/**
 * Draw teams for a week.
 * `history.partners` / `history.opponents` hold `pairKey(a,b)` strings for past weeks.
 */
export function drawTeams(players: Pairable[], history: History = { partners: new Set(), opponents: new Set() }, seed = 1): { teams: TeamDraft[]; matches: MatchDraft[] } {
  if (players.length === 0) return { teams: [], matches: [] };
  const known = players.filter((p) => p.handicap != null).map((p) => p.handicap as number);
  const avg = known.length ? known.reduce((s, v) => s + v, 0) / known.length : 10;
  const hc = (p: Pairable) => (p.handicap == null ? avg : p.handicap);

  // Deterministic jitter so equal handicaps don't always sort the same way.
  const rnd = mulberry32(seed);
  const sorted = [...players].sort((a, b) => hc(a) - hc(b) || rnd() - 0.5);

  // Strong-with-weak pairing with a one-step swap when the natural partner was a recent partner.
  const teams: TeamDraft[] = [];
  const pool = [...sorted];
  let n = 1;
  while (pool.length > 1) {
    const strong = pool.shift()!;
    let idx = pool.length - 1;
    if (history.partners.has(key(strong.playerId, pool[idx]!.playerId))) {
      for (let j = pool.length - 2; j >= 0; j--) {
        if (!history.partners.has(key(strong.playerId, pool[j]!.playerId))) {
          idx = j;
          break;
        }
      }
    }
    const weak = pool.splice(idx, 1)[0]!;
    teams.push({ teamNumber: n++, player1Id: strong.playerId, player2Id: weak.playerId, strength: hc(strong) + hc(weak) });
  }
  if (pool.length === 1) {
    // Odd roster: last player plays solo (their ball is the team's ball).
    const solo = pool[0]!;
    teams.push({ teamNumber: n++, player1Id: solo.playerId, player2Id: null, strength: hc(solo) * 2 });
  }

  // Matchups: adjacent teams by strength; swap neighbours when they've met recently.
  const byStrength = [...teams].sort((a, b) => a.strength - b.strength);
  const matches: MatchDraft[] = [];
  const met = (a: TeamDraft, b: TeamDraft) => {
    const ids = (t: TeamDraft) => [t.player1Id, t.player2Id].filter(Boolean) as string[];
    return ids(a).some((x) => ids(b).some((y) => history.opponents.has(key(x, y))));
  };
  const queue = [...byStrength];
  while (queue.length > 1) {
    const a = queue.shift()!;
    let idx = 0;
    if (met(a, queue[0]!) && queue.length > 1 && !met(a, queue[1]!)) idx = 1;
    const b = queue.splice(idx, 1)[0]!;
    matches.push({ team1: a.teamNumber, team2: b.teamNumber });
  }
  if (queue.length === 1) matches.push({ team1: queue[0]!.teamNumber, team2: null });
  return { teams, matches };
}

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ───────────────────────── Match play ───────────────────────── */

export type HoleCard = number[] | null; // 18 gross hole scores, null = no round this week

export type MatchOutcome = "NOT_PLAYED" | "PLAYED" | "FORFEIT_T1" | "FORFEIT_T2" | "DOUBLE_FORFEIT" | "BYE" | "TIE";

export type MatchResult = { team1Holes: number; team2Holes: number; winner: 1 | 2 | null; outcome: MatchOutcome };

/** Best ball: per hole the lower score on each team is compared; lower wins the hole, ties push. */
export function bestBall(cards: HoleCard[]): (number | null)[] {
  const played = cards.filter((c): c is number[] => Array.isArray(c) && c.length === 18);
  if (played.length === 0) return Array(18).fill(null);
  return Array.from({ length: 18 }, (_, i) => Math.min(...played.map((c) => c[i]!)));
}

export function playMatch(team1: HoleCard[], team2: HoleCard[] | null): MatchResult {
  if (team2 === null) return { team1Holes: 0, team2Holes: 0, winner: 1, outcome: "BYE" };
  const b1 = bestBall(team1);
  const b2 = bestBall(team2);
  const t1Played = b1.some((h) => h != null);
  const t2Played = b2.some((h) => h != null);
  if (!t1Played && !t2Played) return { team1Holes: 0, team2Holes: 0, winner: null, outcome: "DOUBLE_FORFEIT" };
  if (!t1Played) return { team1Holes: 0, team2Holes: 0, winner: 2, outcome: "FORFEIT_T1" };
  if (!t2Played) return { team1Holes: 0, team2Holes: 0, winner: 1, outcome: "FORFEIT_T2" };
  let t1 = 0;
  let t2 = 0;
  for (let i = 0; i < 18; i++) {
    const a = b1[i] as number;
    const b = b2[i] as number;
    if (a < b) t1++;
    else if (b < a) t2++;
  }
  if (t1 === t2) return { team1Holes: t1, team2Holes: t2, winner: null, outcome: "TIE" };
  return { team1Holes: t1, team2Holes: t2, winner: t1 > t2 ? 1 : 2, outcome: "PLAYED" };
}
