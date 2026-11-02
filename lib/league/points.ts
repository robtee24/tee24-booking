/**
 * Points. One leaderboard, three ways to earn:
 *  - Individual straight (gross):   top 5 → 3, top 10 → 2, top 15 → 1
 *  - Individual handicapped (net):  same table
 *  - Team match win → 2 (tie → configurable, default 1)
 */

export type PointsSettings = { pointsTop5: number; pointsTop10: number; pointsTop15: number; pointsTeamWin: number; pointsTeamTie: number };

export const DEFAULT_POINTS: PointsSettings = { pointsTop5: 3, pointsTop10: 2, pointsTop15: 1, pointsTeamWin: 2, pointsTeamTie: 1 };

/**
 * Standard competition ranking ("1224"): tied players share the best rank and
 * the next rank is skipped. Lower score ranks first.
 */
export function rankByScore<T>(rows: T[], score: (row: T) => number | null | undefined): Map<T, number> {
  const ranked = rows.filter((r) => Number.isFinite(score(r) as number)).sort((a, b) => (score(a) as number) - (score(b) as number));
  const out = new Map<T, number>();
  let rank = 0;
  let prev: number | null = null;
  ranked.forEach((row, i) => {
    const s = score(row) as number;
    if (prev === null || s !== prev) rank = i + 1;
    prev = s;
    out.set(row, rank);
  });
  return out;
}

export function pointsForRank(rank: number | null | undefined, settings: PointsSettings = DEFAULT_POINTS): number {
  if (rank == null || rank <= 0) return 0;
  if (rank <= 5) return settings.pointsTop5;
  if (rank <= 10) return settings.pointsTop10;
  if (rank <= 15) return settings.pointsTop15;
  return 0;
}
