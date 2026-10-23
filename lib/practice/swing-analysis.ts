/**
 * Turn raw shots into per-club stats and a list of coaching "flags".
 * Flags map onto focus areas and carry a severity (0–1) so the plan engine
 * can re-weight a member's plan as new sessions come in.
 */
import { clubGroup, type ClubGroup, type ParsedShot } from "./gspro-csv";
import type { FocusAreaKey } from "./drills";

export type ShotLike = Omit<ParsedShot, "raw" | "shotAt"> & { shotAt?: Date | string | null };

export type ClubStats = {
  club: string;
  group: ClubGroup;
  n: number;
  carry: { mean: number; sd: number; cv: number } | null;
  total: number | null;
  ballSpeed: number | null;
  clubSpeed: number | null;
  smash: number | null;
  launchAngle: number | null;
  backSpin: number | null;
  spinAxis: number | null;
  sideSpin: number | null;
  offlineSd: number | null;
  offlineMean: number | null;
  launchDirSd: number | null;
  attackAngle: number | null;
  faceToPath: number | null;
  clubPath: number | null;
  descentAngle: number | null;
  apex: number | null;
};

export type SwingFlag = {
  key: string;
  area: FocusAreaKey;
  severity: number; // 0..1
  club: string | null;
  title: string;
  detail: string;
  metric: string;
};

export type SwingSummary = {
  shots: number;
  clubs: ClubStats[];
  flags: SwingFlag[];
  /** Benchmarks met */
  highlights: string[];
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sd = (xs: number[]) => {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const r1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);
const r0 = (n: number | null) => (n == null ? null : Math.round(n));
const vals = <T>(xs: T[], f: (x: T) => number | null | undefined): number[] => xs.map(f).filter((v): v is number => typeof v === "number" && Number.isFinite(v));

/** Trim obvious mishits/outliers (top/bottom 10% by carry) when there are enough shots. */
function trimmed(shots: ShotLike[]): ShotLike[] {
  if (shots.length < 8) return shots;
  const withCarry = shots.filter((s) => s.carry != null).sort((a, b) => a.carry! - b.carry!);
  const cut = Math.floor(withCarry.length * 0.1);
  return withCarry.slice(cut, withCarry.length - cut);
}

export function clubStats(shots: ShotLike[]): ClubStats[] {
  const byClub = new Map<string, ShotLike[]>();
  for (const s of shots) {
    if (!s.club || s.club === "Unknown") continue;
    const list = byClub.get(s.club) ?? [];
    list.push(s);
    byClub.set(s.club, list);
  }
  const out: ClubStats[] = [];
  for (const [club, all] of byClub) {
    const t = trimmed(all);
    const carries = vals(t, (s) => s.carry);
    const carryMean = mean(carries);
    const carrySd = sd(carries);
    out.push({
      club,
      group: clubGroup(club),
      n: all.length,
      carry: carryMean != null ? { mean: r1(carryMean)!, sd: r1(carrySd ?? 0)!, cv: carrySd != null && carryMean > 0 ? Math.round((carrySd / carryMean) * 1000) / 10 : 0 } : null,
      total: r1(mean(vals(t, (s) => s.total))),
      ballSpeed: r1(mean(vals(t, (s) => s.ballSpeed))),
      clubSpeed: r1(mean(vals(t, (s) => s.clubSpeed))),
      smash: r1(mean(vals(t, (s) => s.smashFactor)) == null ? null : Math.round(mean(vals(t, (s) => s.smashFactor))! * 1000) / 1000),
      launchAngle: r1(mean(vals(t, (s) => s.launchAngle))),
      backSpin: r0(mean(vals(t, (s) => s.backSpin))),
      spinAxis: r1(mean(vals(t, (s) => s.spinAxis))),
      sideSpin: r0(mean(vals(t, (s) => s.sideSpin))),
      offlineSd: r1(sd(vals(all, (s) => s.offline))),
      offlineMean: r1(mean(vals(all, (s) => s.offline))),
      launchDirSd: r1(sd(vals(all, (s) => s.launchDir))),
      attackAngle: r1(mean(vals(t, (s) => s.attackAngle))),
      faceToPath: r1(mean(vals(t, (s) => s.faceToPath))),
      clubPath: r1(mean(vals(t, (s) => s.clubPath))),
      descentAngle: r1(mean(vals(t, (s) => s.descentAngle))),
      apex: r1(mean(vals(t, (s) => s.apex))),
    });
  }
  const order: ClubGroup[] = ["driver", "wood", "hybrid", "long_iron", "mid_iron", "short_iron", "wedge", "putter", "other"];
  return out.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.club.localeCompare(b.club));
}

const sev = (x: number, lo: number, hi: number) => Math.max(0, Math.min(1, (x - lo) / (hi - lo)));

/**
 * Derive flags. `handedness` flips the sign convention for curve metrics
 * (positive spin axis / side spin = fade/slice for a right-hander).
 */
export function analyzeShots(shots: ShotLike[], opts: { handedness?: "RH" | "LH" | null } = {}): SwingSummary {
  const lh = opts.handedness === "LH";
  const sign = lh ? -1 : 1;
  const stats = clubStats(shots);
  const flags: SwingFlag[] = [];
  const highlights: string[] = [];
  const push = (f: Omit<SwingFlag, "severity"> & { severity: number }) => {
    if (f.severity > 0.05) flags.push({ ...f, severity: Math.round(f.severity * 100) / 100 });
  };

  const driver = stats.find((s) => s.group === "driver" && s.n >= 5);
  if (driver) {
    const axis = driver.spinAxis != null ? driver.spinAxis * sign : null;
    const side = driver.sideSpin != null ? driver.sideSpin * sign : null;
    const ftp = driver.faceToPath != null ? driver.faceToPath * sign : null;
    const curveRight = Math.max(axis != null ? sev(axis, 5, 14) : 0, side != null ? sev(side, 350, 900) : 0, ftp != null ? sev(ftp, 2.5, 6) : 0);
    const curveLeft = Math.max(axis != null ? sev(-axis, 5, 14) : 0, side != null ? sev(-side, 350, 900) : 0, ftp != null ? sev(-ftp, 2.5, 6) : 0);
    if (curveRight > 0) push({ key: "slice_driver", area: "driver_accuracy", club: driver.club, severity: curveRight, title: lh ? "Driver curves left (slice)" : "Driver curves right (slice)", detail: `Average spin axis ${driver.spinAxis ?? "—"}°${driver.faceToPath != null ? `, face-to-path ${driver.faceToPath}°` : ""}. The face is open to the path at impact.`, metric: "Spin Axis / Face to Path" });
    if (curveLeft > 0) push({ key: "hook_driver", area: "driver_accuracy", club: driver.club, severity: curveLeft, title: lh ? "Driver curves right (hook)" : "Driver curves left (hook)", detail: `Average spin axis ${driver.spinAxis ?? "—"}°. The face is closed to the path at impact.`, metric: "Spin Axis / Face to Path" });
    if (driver.backSpin != null) {
      if (driver.backSpin > 3200) push({ key: "high_spin_driver", area: "spin_control", club: driver.club, severity: sev(driver.backSpin, 3200, 4500), title: "Driver spin is costing distance", detail: `Averaging ${driver.backSpin} rpm; 2,000–2,800 is the window for your speed. Likely a downward strike or low face contact.`, metric: "Back Spin" });
      if (driver.backSpin < 1700) push({ key: "low_spin_driver", area: "spin_control", club: driver.club, severity: sev(1700 - driver.backSpin, 0, 700), title: "Driver spin too low to hold the air", detail: `Averaging ${driver.backSpin} rpm — carry falls off and misses get exaggerated.`, metric: "Back Spin" });
    }
    if (driver.launchAngle != null) {
      if (driver.launchAngle < 9.5) push({ key: "low_launch_driver", area: "spin_control", club: driver.club, severity: sev(9.5 - driver.launchAngle, 0, 5), title: "Driver launches too low", detail: `Average launch ${driver.launchAngle}°. Aim for 12–15° with a slightly upward attack angle.`, metric: "Launch Angle" });
      if (driver.launchAngle > 17.5) push({ key: "high_launch_driver", area: "spin_control", club: driver.club, severity: sev(driver.launchAngle - 17.5, 0, 5), title: "Driver balloons", detail: `Average launch ${driver.launchAngle}° — too high, you're giving up roll and fighting wind.`, metric: "Launch Angle" });
    }
    if (driver.attackAngle != null && driver.attackAngle < -1.5) push({ key: "down_on_driver", area: "distance", club: driver.club, severity: sev(-driver.attackAngle, 1.5, 5), title: "Hitting down on the driver", detail: `Attack angle ${driver.attackAngle}°. Level-to-up (0° to +4°) adds launch and cuts spin for free yards.`, metric: "Attack Angle" });
    if (driver.smash != null && driver.smash < 1.43) push({ key: "low_smash_driver", area: "distance", club: driver.club, severity: sev(1.43 - driver.smash, 0, 0.1), title: "Off-center driver contact", detail: `Smash factor ${driver.smash} (1.46–1.50 is center contact). You're leaving ball speed on the table.`, metric: "Smash Factor" });
    if (driver.offlineSd != null && driver.offlineSd > 22) push({ key: "driver_dispersion", area: "consistency", club: driver.club, severity: sev(driver.offlineSd, 22, 45), title: "Wide driver dispersion", detail: `Left/right spread of ±${driver.offlineSd} yd. Tightening this is the fastest way to lower scores.`, metric: "Offline (std dev)" });
    if (driver.smash != null && driver.smash >= 1.46) highlights.push(`Driver smash factor ${driver.smash} — center-face contact.`);
    if (driver.backSpin != null && driver.backSpin >= 2000 && driver.backSpin <= 2800 && driver.launchAngle != null && driver.launchAngle >= 11.5) highlights.push("Driver launch and spin are in the optimal window.");
    if (driver.clubSpeed != null) highlights.push(`Driver club speed ${driver.clubSpeed} mph, carry ${driver.carry?.mean ?? "—"} yd.`);
  }

  const irons = stats.filter((s) => ["long_iron", "mid_iron", "short_iron"].includes(s.group) && s.n >= 4);
  for (const c of irons) {
    if (c.smash != null && c.smash < (c.group === "long_iron" ? 1.36 : c.group === "mid_iron" ? 1.3 : 1.26)) {
      push({ key: `low_smash_${c.club}`, area: "iron_contact", club: c.club, severity: sev((c.group === "long_iron" ? 1.36 : c.group === "mid_iron" ? 1.3 : 1.26) - c.smash, 0, 0.08), title: `${c.club} strike quality`, detail: `Smash factor ${c.smash} says contact is off-center or heavy. Low-point control drills fix this fastest.`, metric: "Smash Factor" });
    }
    if (c.attackAngle != null && c.attackAngle > 0.5) push({ key: `up_on_${c.club}`, area: "iron_contact", club: c.club, severity: sev(c.attackAngle, 0.5, 4), title: `Hitting up on your ${c.club}`, detail: `Attack angle ${c.attackAngle}°. Irons want -2° to -5° so you strike the ball before the mat — this pattern produces thin and fat shots.`, metric: "Attack Angle" });
    if (c.carry && c.carry.cv > 7 && c.n >= 6) push({ key: `carry_cv_${c.club}`, area: "distance_control", club: c.club, severity: sev(c.carry.cv, 7, 15), title: `${c.club} carry is unpredictable`, detail: `Carry varies ±${c.carry.sd} yd (${c.carry.cv}%). You can't pick a club if the number moves that much.`, metric: "Carry (std dev)" });
    if (c.offlineSd != null && c.offlineSd > 14) push({ key: `offline_${c.club}`, area: "start_line", club: c.club, severity: sev(c.offlineSd, 14, 30), title: `${c.club} start line wanders`, detail: `Left/right spread ±${c.offlineSd} yd${c.launchDirSd != null ? `, launch direction ±${c.launchDirSd}°` : ""}. Face control at impact is the lever.`, metric: "Offline / Launch Direction" });
    if (c.group === "mid_iron" && c.descentAngle != null && c.descentAngle < 40) push({ key: `low_descent_${c.club}`, area: "spin_control", club: c.club, severity: sev(40 - c.descentAngle, 0, 10), title: `${c.club} comes in too flat`, detail: `Descent angle ${c.descentAngle}°. Under 45° the ball won't hold greens — usually low spin or low launch.`, metric: "Descent Angle" });
    if (c.smash != null && c.smash >= 1.33 && c.group === "mid_iron") highlights.push(`${c.club} smash factor ${c.smash} — flush.`);
  }

  const wedges = stats.filter((s) => s.group === "wedge" && s.n >= 4);
  for (const c of wedges) {
    if (c.carry && c.carry.cv > 8) push({ key: `wedge_cv_${c.club}`, area: "distance_control", club: c.club, severity: sev(c.carry.cv, 8, 18), title: `${c.club} distance control`, detail: `Carry varies ±${c.carry.sd} yd. Wedges should repeat within ±5 yd — build your clock system.`, metric: "Carry (std dev)" });
  }
  // Wedge gapping
  const wedgeCarries = wedges.filter((w) => w.carry).map((w) => w.carry!.mean).sort((a, b) => a - b);
  for (let i = 1; i < wedgeCarries.length; i++) {
    const gap = wedgeCarries[i]! - wedgeCarries[i - 1]!;
    if (gap > 20 || gap < 5) {
      push({ key: "wedge_gapping", area: "distance_control", club: null, severity: gap > 20 ? sev(gap, 20, 35) : sev(5 - gap, 0, 5), title: "Wedge gaps are uneven", detail: `A ${Math.round(gap)} yd gap between two wedges leaves you with awkward in-between yardages.`, metric: "Carry gaps" });
      break;
    }
  }

  // Overall start-line control across the bag
  const dirSds = stats.filter((s) => s.launchDirSd != null && s.n >= 5).map((s) => s.launchDirSd!);
  const avgDirSd = mean(dirSds);
  if (avgDirSd != null && avgDirSd > 4.5) push({ key: "start_line_global", area: "start_line", club: null, severity: sev(avgDirSd, 4.5, 9), title: "Start line varies across the bag", detail: `Launch direction spread averages ±${r1(avgDirSd)}°. Gate and window drills tighten this quickly.`, metric: "Launch Direction (std dev)" });

  // Collapse duplicate keys keeping the highest severity, sort by severity.
  const dedup = new Map<string, SwingFlag>();
  for (const f of flags) {
    const prev = dedup.get(f.key);
    if (!prev || prev.severity < f.severity) dedup.set(f.key, f);
  }
  const sorted = [...dedup.values()].sort((a, b) => b.severity - a.severity);
  return { shots: shots.length, clubs: stats, flags: sorted, highlights: highlights.slice(0, 4) };
}

/** Merge multiple session summaries, weighting recent sessions more. */
export function mergeFlags(summaries: { flags: SwingFlag[]; playedAt: Date }[]): SwingFlag[] {
  if (!summaries.length) return [];
  const sorted = [...summaries].sort((a, b) => b.playedAt.getTime() - a.playedAt.getTime());
  const acc = new Map<string, SwingFlag & { w: number }>();
  sorted.forEach((s, i) => {
    const w = 1 / (1 + i * 0.6); // most recent = 1, next = 0.63, then 0.45…
    for (const f of s.flags) {
      const prev = acc.get(f.key);
      if (!prev) acc.set(f.key, { ...f, severity: f.severity * w, w });
      else {
        prev.severity += f.severity * w;
        prev.w += w;
      }
    }
  });
  return [...acc.values()]
    .map(({ w, ...f }) => ({ ...f, severity: Math.round(Math.min(1, f.severity / Math.max(w, 1)) * 100) / 100 }))
    .sort((a, b) => b.severity - a.severity);
}
