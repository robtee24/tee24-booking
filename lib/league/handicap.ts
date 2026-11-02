/**
 * League handicaps.
 *
 * Every week the lowest gross score in the league is the 0 for that week; each
 * player's "strokes back" is their gross minus that low, capped (default 20).
 *
 * A player's handicap for week N is built from their strokes-back in every
 * week before N: for every `throwOutEvery` rounds played the single highest
 * strokes-back is thrown out, the rest are averaged and rounded.
 *
 *  - Weeks 1..openingWeeks (default 2) are played straight. When the opening
 *    period's last Sunday deadline passes, the handicap built from those
 *    rounds is applied retroactively to the opening weeks so the handicapped
 *    league has results for them too, and that same handicap is in force for
 *    week openingWeeks+1 (week 3).
 *  - From then on the handicap is progressive: week N uses weeks 1..N-1
 *    (week 4 uses the handicap computed after week 3, and so on).
 *  - A player with no prior rounds has no handicap that week (straight only).
 */

export type HandicapSettings = { handicapCap: number; throwOutEvery: number; openingWeeks: number };

export const DEFAULT_HANDICAP_SETTINGS: HandicapSettings = { handicapCap: 20, throwOutEvery: 3, openingWeeks: 2 };

/** Strokes back from the week low, floored at 0 and capped. */
export function strokesBack(gross: number, weekLow: number, cap = DEFAULT_HANDICAP_SETTINGS.handicapCap): number {
  return Math.max(0, Math.min(cap, Math.round(gross - weekLow)));
}

/** How many of the highest strokes-back values are dropped for `rounds` rounds. */
export function throwOuts(rounds: number, throwOutEvery = DEFAULT_HANDICAP_SETTINGS.throwOutEvery): number {
  if (throwOutEvery <= 0 || rounds < throwOutEvery) return 0;
  // Never throw out everything.
  return Math.min(Math.floor(rounds / throwOutEvery), rounds - 1);
}

/**
 * Handicap from a history of strokes-back values (oldest → newest ordering
 * does not matter). Returns null when there is nothing to build from.
 */
export function handicapFromHistory(history: number[], settings: Pick<HandicapSettings, "throwOutEvery"> = DEFAULT_HANDICAP_SETTINGS): { handicap: number; roundsUsed: number } | null {
  const vals = history.filter((v) => Number.isFinite(v)).map((v) => Math.max(0, v));
  if (vals.length === 0) return null;
  const drop = throwOuts(vals.length, settings.throwOutEvery);
  const kept = [...vals].sort((a, b) => a - b).slice(0, vals.length - drop);
  const avg = kept.reduce((s, v) => s + v, 0) / kept.length;
  return { handicap: Math.round(avg), roundsUsed: kept.length };
}

/**
 * Which weeks feed the handicap applied to `weekNumber`.
 *  - Opening weeks (<= openingWeeks): the opening weeks themselves (1..openingWeeks),
 *    i.e. retroactive once the opening period closes.
 *  - Later weeks: every week before it.
 */
export function sourceWeeksFor(weekNumber: number, openingWeeks = DEFAULT_HANDICAP_SETTINGS.openingWeeks): number[] {
  const upTo = weekNumber <= openingWeeks ? openingWeeks : weekNumber - 1;
  return Array.from({ length: upTo }, (_, i) => i + 1);
}

/** Week lows (per week number) from a list of gross scores. */
export function weekLows(scores: { weekNumber: number; gross: number }[]): Map<number, number> {
  const lows = new Map<number, number>();
  for (const s of scores) {
    const cur = lows.get(s.weekNumber);
    if (cur === undefined || s.gross < cur) lows.set(s.weekNumber, s.gross);
  }
  return lows;
}

/**
 * Compute the handicap applied to `weekNumber` for one player from all of the
 * player's accepted gross scores (any weeks) and the league's week lows.
 * Only weeks that are complete (deadline passed → in `revealedWeeks`) count.
 */
export function handicapForWeek(input: {
  weekNumber: number;
  playerScores: { weekNumber: number; gross: number }[];
  lows: Map<number, number>;
  revealedWeeks: Set<number>;
  settings?: HandicapSettings;
}): { handicap: number; roundsUsed: number } | null {
  const settings = input.settings ?? DEFAULT_HANDICAP_SETTINGS;
  const sourceWeeks = sourceWeeksFor(input.weekNumber, settings.openingWeeks);
  // Every source week must be closed: handicaps are only ever built from
  // complete weeks (and the opening weeks stay straight until all have closed).
  if (sourceWeeks.some((w) => !input.revealedWeeks.has(w))) return null;
  const source = new Set(sourceWeeks);
  const history: number[] = [];
  for (const s of input.playerScores) {
    if (!source.has(s.weekNumber)) continue;
    const low = input.lows.get(s.weekNumber);
    if (low === undefined) continue;
    history.push(strokesBack(s.gross, low, settings.handicapCap));
  }
  return handicapFromHistory(history, settings);
}
