/**
 * Weekly money.
 *
 * pot = sum of PAID entries for the week.
 *  - first-place pool  = min(pot × firstPlacePct%,  firstPlaceCap)   split equally across the week's 1st-place winners
 *  - second-place pool = min(pot × secondPlacePct%, secondPlaceCap)  split equally across the 2nd-place winners
 *  - remainder → championship pot (100% given away at the end of the season)
 *
 * The weekly winners are: straight 1st, handicapped 1st and the two players on
 * the winning team (so "divided equally across all 4 winners"). A tie for a
 * slot splits that slot's share. Shares that would go to a player who is not
 * eligible for money (minors, flagged) roll into the championship pot.
 */

export type PayoutSettings = { firstPlacePct: number; firstPlaceCapCents: number; secondPlacePct: number; secondPlaceCapCents: number };

export const DEFAULT_PAYOUTS: PayoutSettings = { firstPlacePct: 50, firstPlaceCapCents: 10000, secondPlacePct: 25, secondPlaceCapCents: 5000 };

export type PayoutKind = "GROSS_1" | "GROSS_2" | "NET_1" | "NET_2" | "TEAM_1" | "TEAM_2";

/** A slot is one of the four winner positions in a pool; it may hold several tied players. */
export type PoolSlot = { kind: PayoutKind; playerIds: string[] };

export type PayoutLine = { playerId: string; kind: PayoutKind; amountCents: number };

export function poolCents(potCents: number, pct: number, capCents: number): number {
  return Math.max(0, Math.min(Math.floor((potCents * pct) / 100), capCents));
}

/**
 * Split one pool across its slots. Every slot gets an equal share; within a
 * slot tied players split the share. Ineligible players' money is returned as
 * `toChampionship`. Cents that don't divide evenly also go to the championship pot.
 */
export function splitPool(pool: number, slots: PoolSlot[], eligible: (playerId: string) => boolean): { lines: PayoutLine[]; toChampionship: number } {
  const lines: PayoutLine[] = [];
  let paid = 0;
  const filled = slots.filter((s) => s.playerIds.length > 0);
  if (pool <= 0 || filled.length === 0) return { lines, toChampionship: pool };
  // Shares are per *slot* (4 slots = quarter each), not per filled slot, so an
  // unfilled position (e.g. nobody eligible for net) rolls to the championship.
  const share = Math.floor(pool / Math.max(slots.length, 1));
  for (const slot of filled) {
    const each = Math.floor(share / slot.playerIds.length);
    for (const pid of slot.playerIds) {
      if (!eligible(pid) || each <= 0) continue;
      lines.push({ playerId: pid, kind: slot.kind, amountCents: each });
      paid += each;
    }
  }
  return { lines, toChampionship: pool - paid };
}

export function weeklyPayouts(input: {
  potCents: number;
  settings: PayoutSettings;
  first: { gross: string[]; net: string[]; team: string[] };
  second: { gross: string[]; net: string[]; team: string[] };
  eligible: (playerId: string) => boolean;
}): { lines: PayoutLine[]; paidOutCents: number; toChampionshipCents: number; firstPool: number; secondPool: number } {
  const firstPool = poolCents(input.potCents, input.settings.firstPlacePct, input.settings.firstPlaceCapCents);
  const secondPool = poolCents(input.potCents, input.settings.secondPlacePct, input.settings.secondPlaceCapCents);
  // Team slot: both players of the team are winners, each is a slot of their own
  // so the pool divides across "all 4 winners".
  const teamSlots = (kind: "TEAM_1" | "TEAM_2", ids: string[]): PoolSlot[] => {
    if (ids.length === 0) return [{ kind, playerIds: [] }, { kind, playerIds: [] }];
    // Normally 2 players; byes / solo teams give 1. Tied teams give 4+.
    const perSlot = Math.ceil(ids.length / 2);
    return [
      { kind, playerIds: ids.slice(0, perSlot) },
      { kind, playerIds: ids.slice(perSlot) },
    ];
  };
  const a = splitPool(firstPool, [{ kind: "GROSS_1", playerIds: input.first.gross }, { kind: "NET_1", playerIds: input.first.net }, ...teamSlots("TEAM_1", input.first.team)], input.eligible);
  const b = splitPool(secondPool, [{ kind: "GROSS_2", playerIds: input.second.gross }, { kind: "NET_2", playerIds: input.second.net }, ...teamSlots("TEAM_2", input.second.team)], input.eligible);
  const lines = [...a.lines, ...b.lines];
  const paidOutCents = lines.reduce((s, l) => s + l.amountCents, 0);
  const remainder = Math.max(0, input.potCents - firstPool - secondPool);
  return { lines, paidOutCents, toChampionshipCents: remainder + a.toChampionship + b.toChampionship, firstPool, secondPool };
}
