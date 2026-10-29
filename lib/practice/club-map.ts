/**
 * Club mapping from GSPro shot exports.
 *
 * For each club, use the three most recent exports that contain it. Inside an
 * export, shots outside a normal carry spread are dropped. An export that
 * doesn't match the player's other sessions with that club is dropped. A club
 * whose average doesn't fit the rest of the bag is left off the map — that is
 * what happens when the club wasn't selected on the range and every shot kept
 * the previous club's name.
 *
 * Carry is yards.
 */

export type ClubMapShot = { club: string; carry: number | null };
export type ClubMapExport = { id: string; playedAt: string; shots: ClubMapShot[] };

export type MappedClub = {
  club: string;
  /** Average carry, yards, of the exports that counted. */
  carry: number;
  exportsUsed: number;
  /** Exports in the last three that were set aside. */
  exportsDropped: number;
  shotsUsed: number;
  shotsDropped: number;
  playedAt: string[];
};

export type RejectedClub = { club: string; reason: string };

export type ClubMap = {
  clubs: MappedClub[];
  rejected: RejectedClub[];
  exportCount: number;
};

const EXPORTS_PER_CLUB = 3;
const MIN_SHOTS = 3;
/** Shots farther than this from the export's median are not a normal full swing with that club. */
const SHOT_BAND_YARDS = 12;
const SHOT_BAND_RATIO = 0.1;
/** Export averages farther than this from the player's other sessions with the same club. */
const EXPORT_BAND_YARDS = 18;
const EXPORT_BAND_RATIO = 0.12;
const ORDER = [
  "Driver",
  "3 Wood", "4 Wood", "5 Wood", "7 Wood", "9 Wood",
  "2 Hybrid", "3 Hybrid", "4 Hybrid", "5 Hybrid", "6 Hybrid", "7 Hybrid",
  "2 Iron", "3 Iron", "4 Iron", "5 Iron", "6 Iron", "7 Iron", "8 Iron", "9 Iron",
  "PW", "GW", "SW", "LW",
];

/** Wide full-swing windows. A number outside this isn't a stock shot with that club. */
const ABSOLUTE: Record<string, [number, number]> = {
  Driver: [120, 340],
  "3 Wood": [110, 310],
  "4 Wood": [105, 300],
  "5 Wood": [100, 290],
  "7 Wood": [95, 270],
  "9 Wood": [90, 250],
};

function absoluteWindow(club: string): [number, number] {
  if (ABSOLUTE[club]) return ABSOLUTE[club];
  if (club.endsWith("Hybrid")) return [90, 270];
  const iron = club.match(/^(\d) Iron$/);
  if (iron) {
    const n = Number(iron[1]);
    if (n <= 4) return [110, 250];
    if (n <= 6) return [100, 230];
    if (n <= 8) return [85, 215];
    return [70, 190];
  }
  if (club === "PW") return [55, 160];
  if (club === "GW") return [45, 145];
  if (club === "SW") return [30, 130];
  if (club === "LW") return [20, 115];
  return [20, 340];
}

function rankOf(club: string) {
  const i = ORDER.indexOf(club);
  return i === -1 ? 1000 : i;
}

function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function mean(values: number[]) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

type ExportMean = { playedAt: string; carry: number; used: number; dropped: number };

function cleanExport(carries: number[], playedAt: string): ExportMean | "thin" | "scatter" {
  const usable = carries.filter((c) => c > 15 && c < 400);
  if (usable.length < MIN_SHOTS) return "thin";
  const med = median(usable);
  const band = Math.max(SHOT_BAND_YARDS, med * SHOT_BAND_RATIO);
  const kept = usable.filter((c) => Math.abs(c - med) <= band);
  if (kept.length < MIN_SHOTS) return "scatter";
  return { playedAt, carry: mean(kept), used: kept.length, dropped: usable.length - kept.length };
}

type Candidate = {
  club: string;
  rank: number;
  carry: number;
  exportsUsed: number;
  exportsDropped: number;
  shotsUsed: number;
  shotsDropped: number;
  playedAt: string[];
  spread: number;
};

const BAG_REASON = "These distances don't fit the rest of your bag. The club likely wasn't selected in GSPro when you hit them.";
const DISAGREE_REASON = "Your last exports for this club don't agree with each other. Select the club in GSPro every time you switch.";
const RANGE_REASON = "That distance isn't in a normal range for this club. The shots were probably labeled with the wrong club.";
const SCATTER_REASON = "The shots labeled with this club don't sit in one distance range. Select the club each time you switch so each shot is marked.";
const THIN_REASON = "Not enough full swings with this club in your recent exports. Hit a few and select the club before you swing.";

export function buildClubMap(exportsNewestFirst: ClubMapExport[]): ClubMap {
  const rejected: RejectedClub[] = [];
  const candidates: Candidate[] = [];

  const clubsSeen = new Set<string>();
  for (const exp of exportsNewestFirst) for (const shot of exp.shots) if (shot.club && shot.club !== "Unknown" && shot.club !== "Putter") clubsSeen.add(shot.club);

  for (const club of clubsSeen) {
    const recent = exportsNewestFirst.filter((exp) => exp.shots.some((s) => s.club === club)).slice(0, EXPORTS_PER_CLUB);
    const [lo, hi] = absoluteWindow(club);
    const means: ExportMean[] = [];
    let scatter = 0;
    let outOfRange = 0;
    for (const exp of recent) {
      const carries = exp.shots.filter((s) => s.club === club).map((s) => s.carry).filter((c): c is number => typeof c === "number" && Number.isFinite(c));
      const cleaned = cleanExport(carries, exp.playedAt);
      if (cleaned === "thin") continue;
      if (cleaned === "scatter") {
        scatter++;
        continue;
      }
      if (cleaned.carry < lo || cleaned.carry > hi) {
        outOfRange++;
        continue;
      }
      means.push(cleaned);
    }

    if (!means.length) {
      const reason = outOfRange ? RANGE_REASON : scatter ? SCATTER_REASON : THIN_REASON;
      rejected.push({ club, reason });
      continue;
    }

    const med = median(means.map((m) => m.carry));
    const band = Math.max(EXPORT_BAND_YARDS, med * EXPORT_BAND_RATIO);
    const agreed = means.filter((m) => Math.abs(m.carry - med) <= band);
    if (means.length >= 2 && agreed.length < 2) {
      rejected.push({ club, reason: DISAGREE_REASON });
      continue;
    }

    const used = agreed.length ? agreed : means;
    const carries = used.map((m) => m.carry);
    candidates.push({
      club,
      rank: rankOf(club),
      carry: mean(carries),
      exportsUsed: used.length,
      exportsDropped: recent.length - used.length,
      shotsUsed: used.reduce((a, m) => a + m.used, 0),
      shotsDropped: used.reduce((a, m) => a + m.dropped, 0),
      playedAt: used.map((m) => m.playedAt),
      spread: Math.max(...carries) - Math.min(...carries),
    });
  }

  const fitted = fitBag(candidates);
  rejected.push(...fitted.rejected);

  const clubs: MappedClub[] = fitted.kept
    .sort((a, b) => a.rank - b.rank || a.club.localeCompare(b.club))
    .map((c) => ({
      club: c.club,
      carry: Math.round(c.carry),
      exportsUsed: c.exportsUsed,
      exportsDropped: c.exportsDropped,
      shotsUsed: c.shotsUsed,
      shotsDropped: c.shotsDropped,
      playedAt: c.playedAt,
    }));

  rejected.sort((a, b) => rankOf(a.club) - rankOf(b.club) || a.club.localeCompare(b.club));
  return { clubs, rejected, exportCount: exportsNewestFirst.length };
}

/** Typical carry as a fraction of a full driver, used to see whether a club fits this player. */
const DRIVER_FRACTION: Record<string, number> = {
  Driver: 1,
  "3 Wood": 0.93,
  "4 Wood": 0.9,
  "5 Wood": 0.87,
  "7 Wood": 0.84,
  "9 Wood": 0.8,
  "2 Hybrid": 0.9,
  "3 Hybrid": 0.86,
  "4 Hybrid": 0.82,
  "5 Hybrid": 0.78,
  "6 Hybrid": 0.74,
  "7 Hybrid": 0.7,
  "2 Iron": 0.88,
  "3 Iron": 0.84,
  "4 Iron": 0.8,
  "5 Iron": 0.76,
  "6 Iron": 0.72,
  "7 Iron": 0.67,
  "8 Iron": 0.62,
  "9 Iron": 0.57,
  PW: 0.52,
  GW: 0.46,
  SW: 0.4,
  LW: 0.34,
};

function fitBag(poolIn: Candidate[]): { kept: Candidate[]; rejected: RejectedClub[] } {
  const rejected: RejectedClub[] = [];
  const loose = poolIn.filter((c) => DRIVER_FRACTION[c.club] == null);
  let pool = poolIn.filter((c) => DRIVER_FRACTION[c.club] != null);

  for (let guard = 0; guard < 8 && pool.length >= 2; guard++) {
    const implied = pool.map((c) => c.carry / DRIVER_FRACTION[c.club]!);
    const med = median(implied);
    const band = Math.max(36, med * 0.18);
    let worst = 0;
    let worstAbs = Math.abs(implied[0]! - med);
    for (let i = 1; i < pool.length; i++) {
      const dist = Math.abs(implied[i]! - med);
      const tie = Math.abs(dist - worstAbs) < 0.5;
      // On a tie, the longer club is the one that was usually left selected.
      if (dist > worstAbs || (tie && pool[i]!.rank < pool[worst]!.rank)) {
        worst = i;
        worstAbs = dist;
      }
    }
    if (worstAbs <= band) break;
    const drop = pool[worst]!;
    pool = pool.filter((_, i) => i !== worst);
    rejected.push({ club: drop.club, reason: BAG_REASON });
  }

  return { kept: [...pool, ...loose], rejected };
}
