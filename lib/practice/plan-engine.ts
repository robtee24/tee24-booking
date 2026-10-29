/**
 * Builds a personalized practice plan from the survey (goals, misses, weak
 * clubs, time budget) and whatever swing data has been imported.
 *
 * Deterministic rules, no model calls: every weight is explainable and the
 * plan re-scores itself as new sessions arrive (flags shift the weights).
 */
import { DRILL_BY_KEY, DRILLS, FOCUS_AREAS, PATTERN_LABEL, type Drill, type FocusAreaKey, type PatternKey } from "./drills";
import type { SwingFlag } from "./swing-analysis";

export type SurveyInput = {
  handicap?: number | null;
  experience?: "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | null;
  sessionsPerWeek?: number | null;
  minutesPerSession?: number | null;
  handedness?: "RH" | "LH" | null;
  goals: string[];
  issues: string[];
  weakClubs: string[];
  misses: string[];
};

export const SURVEY_OPTIONS = {
  goals: [
    { key: "break_100", label: "Break 100" },
    { key: "break_90", label: "Break 90" },
    { key: "break_80", label: "Break 80" },
    { key: "more_distance", label: "Hit it farther" },
    { key: "more_fairways", label: "Hit more fairways" },
    { key: "more_greens", label: "Hit more greens" },
    { key: "better_short_game", label: "Get up and down more" },
    { key: "fewer_putts", label: "Fewer putts" },
    { key: "consistency", label: "Be more consistent" },
    { key: "league_ready", label: "Compete in league play" },
    { key: "have_fun", label: "Enjoy it more / stay sharp" },
  ],
  issues: [
    { key: "slice", label: "I slice it" },
    { key: "hook", label: "I hook it" },
    { key: "fat_shots", label: "Fat / heavy contact" },
    { key: "thin_shots", label: "Thin / topped shots" },
    { key: "inconsistent_contact", label: "Contact is all over the place" },
    { key: "distance_control", label: "Can't control distance" },
    { key: "short_game", label: "Chipping / pitching" },
    { key: "putting", label: "Putting" },
    { key: "driver", label: "Driver is a liability" },
    { key: "course_management", label: "Blow-up holes / bad decisions" },
    { key: "nerves", label: "Fall apart under pressure" },
  ],
  weakClubs: [
    { key: "driver", label: "Driver" },
    { key: "woods", label: "Fairway woods / hybrids" },
    { key: "long_irons", label: "Long irons" },
    { key: "mid_irons", label: "Mid irons" },
    { key: "short_irons", label: "Short irons" },
    { key: "wedges", label: "Wedges" },
    { key: "putter", label: "Putter" },
  ],
  misses: [
    { key: "slice", label: "Slice" },
    { key: "fade", label: "Weak fade" },
    { key: "hook", label: "Hook" },
    { key: "pull", label: "Pull" },
    { key: "push", label: "Push" },
    { key: "fat", label: "Fat" },
    { key: "thin", label: "Thin" },
    { key: "short", label: "Comes up short" },
  ],
} as const;

type Weights = Record<FocusAreaKey, number>;

const zero = (): Weights => ({
  driver_accuracy: 0,
  distance: 0,
  iron_contact: 0,
  distance_control: 0,
  short_game: 0,
  putting: 0,
  start_line: 0,
  spin_control: 0,
  consistency: 0,
  course_management: 0,
});

const GOAL_W: Record<string, Partial<Weights>> = {
  break_100: { iron_contact: 2, course_management: 2, short_game: 1.5, putting: 1, consistency: 1 },
  break_90: { short_game: 2, course_management: 1.5, putting: 1.5, driver_accuracy: 1, distance_control: 1 },
  break_80: { distance_control: 2, putting: 2, start_line: 1.5, short_game: 1, spin_control: 0.5 },
  more_distance: { distance: 3, spin_control: 1.5 },
  more_fairways: { driver_accuracy: 3, start_line: 1.5 },
  more_greens: { distance_control: 2, start_line: 2, iron_contact: 1 },
  better_short_game: { short_game: 3, distance_control: 1 },
  fewer_putts: { putting: 3 },
  consistency: { consistency: 2.5, iron_contact: 1 },
  league_ready: { course_management: 2, consistency: 1.5, putting: 1 },
  have_fun: { course_management: 1, consistency: 1 },
};

const ISSUE_W: Record<string, Partial<Weights>> = {
  slice: { driver_accuracy: 2.5, start_line: 1.5 },
  hook: { driver_accuracy: 2, start_line: 1.5 },
  fat_shots: { iron_contact: 3 },
  thin_shots: { iron_contact: 3 },
  inconsistent_contact: { iron_contact: 2, consistency: 2 },
  distance_control: { distance_control: 3 },
  short_game: { short_game: 3 },
  putting: { putting: 3 },
  driver: { driver_accuracy: 2, spin_control: 1 },
  course_management: { course_management: 3 },
  nerves: { consistency: 1.5, course_management: 1.5 },
};

const WEAK_CLUB_W: Record<string, Partial<Weights>> = {
  driver: { driver_accuracy: 1.5, spin_control: 1 },
  woods: { iron_contact: 1, consistency: 1 },
  long_irons: { iron_contact: 1.5, distance: 0.5 },
  mid_irons: { iron_contact: 1, distance_control: 1 },
  short_irons: { distance_control: 1.5, start_line: 0.5 },
  wedges: { distance_control: 1.5, short_game: 1 },
  putter: { putting: 2 },
};

const MISS_W: Record<string, Partial<Weights>> = {
  slice: { driver_accuracy: 1.5, start_line: 1 },
  fade: { distance: 0.5, start_line: 1 },
  hook: { driver_accuracy: 1, start_line: 1 },
  pull: { start_line: 1.5 },
  push: { start_line: 1.5 },
  fat: { iron_contact: 2 },
  thin: { iron_contact: 2 },
  short: { distance: 1, distance_control: 1 },
};

function add(w: Weights, part: Partial<Weights>, scale = 1) {
  for (const [k, v] of Object.entries(part) as [FocusAreaKey, number][]) w[k] += v * scale;
}

export type FocusArea = { key: FocusAreaKey; label: string; blurb: string; weight: number; reasons: string[] };

export function scoreFocusAreas(survey: SurveyInput, flags: SwingFlag[]): FocusArea[] {
  const w = zero();
  const reasons: Record<FocusAreaKey, Set<string>> = Object.fromEntries((Object.keys(w) as FocusAreaKey[]).map((k) => [k, new Set<string>()])) as Record<FocusAreaKey, Set<string>>;

  const tag = (part: Partial<Weights>, why: string) => {
    for (const k of Object.keys(part) as FocusAreaKey[]) reasons[k].add(why);
  };
  for (const g of survey.goals) if (GOAL_W[g]) {
    add(w, GOAL_W[g]!);
    tag(GOAL_W[g]!, `Goal: ${SURVEY_OPTIONS.goals.find((o) => o.key === g)?.label ?? g}`);
  }
  for (const i of survey.issues) if (ISSUE_W[i]) {
    add(w, ISSUE_W[i]!, 1.4); // the member's own complaint outranks generic goal priors
    tag(ISSUE_W[i]!, `You said: ${SURVEY_OPTIONS.issues.find((o) => o.key === i)?.label ?? i}`);
  }
  for (const c of survey.weakClubs) if (WEAK_CLUB_W[c]) {
    add(w, WEAK_CLUB_W[c]!, 0.8);
    tag(WEAK_CLUB_W[c]!, `Weak spot: ${SURVEY_OPTIONS.weakClubs.find((o) => o.key === c)?.label ?? c}`);
  }
  for (const m of survey.misses) if (MISS_W[m]) {
    add(w, MISS_W[m]!, 0.7);
    tag(MISS_W[m]!, `Typical miss: ${SURVEY_OPTIONS.misses.find((o) => o.key === m)?.label ?? m}`);
  }

  // Handicap priors — what moves the needle at each level
  const hc = survey.handicap ?? (survey.experience === "BEGINNER" ? 28 : survey.experience === "ADVANCED" ? 8 : 18);
  if (hc >= 25) add(w, { iron_contact: 1.5, course_management: 1, short_game: 0.5 });
  else if (hc >= 15) add(w, { short_game: 1, driver_accuracy: 0.75, putting: 0.5 });
  else if (hc >= 8) add(w, { distance_control: 1, putting: 0.75, start_line: 0.5 });
  else add(w, { distance_control: 1, spin_control: 0.75, putting: 0.75 });

  // Swing data beats self-report: flags carry up to 4 points each by severity.
  for (const f of flags) {
    w[f.area] += 4 * f.severity;
    reasons[f.area].add(`Swing data: ${f.title}`);
  }

  // Everyone warms up / transfers to the course a little.
  w.consistency += 0.5;
  w.course_management += 0.25;

  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  return (Object.keys(w) as FocusAreaKey[])
    .map((k) => ({ key: k, label: FOCUS_AREAS[k].label, blurb: FOCUS_AREAS[k].blurb, weight: Math.round((w[k] / total) * 1000) / 1000, reasons: [...reasons[k]].slice(0, 4) }))
    .sort((a, b) => b.weight - a.weight);
}

export type PlanDrill = { key: string; minutes: number; area: FocusAreaKey; note?: string };
export type PlanSession = { day: number; title: string; focus: FocusAreaKey[]; minutes: number; drills: PlanDrill[] };

export type GeneratedPlan = {
  title: string;
  summary: string;
  focusAreas: FocusArea[];
  schedule: PlanSession[];
  drills: Drill[];
  basis: {
    surveyAt: string;
    sessionsAnalyzed: number;
    shotsAnalyzed: number;
    flags: SwingFlag[];
    handicap: number | null;
    handedness: "RH" | "LH" | null;
    /** What the plan is built around, strongest first */
    patterns: { key: PatternKey; label: string; strength: number; sources: string[] }[];
  };
};

/** One-line explanation of how the plan attacks the member's lead complaint. */
const PATTERN_APPROACH: Record<PatternKey, string> = {
  hook: "You told us you hook it, so every full-swing drill here works on a neutral grip, a quieter release and a body turn that squares the face — nothing that encourages more hand action.",
  slice: "You told us you slice it, so the full-swing drills shallow the path and get the face closing through impact — not a single hold-off or anti-hook drill in here.",
  fade: "Your miss is a weak fade, so we're working on a squarer face through impact and a path that comes from inside.",
  pull: "You pull it, so the work is on start line: face control through the gate and a chest that keeps turning instead of the hands taking over.",
  push: "You push it, so the work is on start line and getting the face square to the target through impact.",
  fat: "Heavy contact is the headline, so the drills move your low point in front of the ball before anything else.",
  thin: "Thin shots are the headline, so the drills move your low point in front of the ball and keep your chest over it.",
  contact: "Contact is the headline, so the drills groove one low point and one tempo before we chase anything else.",
  short: "You want more distance, so we're building speed on top of center-face contact and a better launch window.",
  distance_control: "Distance control is the headline: gapping, the clock system and random-yardage games so you can pick a number and hit it.",
  short_game: "Up-and-downs are the headline, so chipping and pitching get the biggest share of every session.",
  putting: "Putting is the headline: speed first, then start line, then pressure.",
  driver: "Driver is the headline, so we're fixing the tee shot first — face control, strike and launch — before anything else.",
  course_management: "Scoring decisions are the headline, so every session ends with a simulated-round game to practise picking smart targets.",
  nerves: "Holding it together under pressure is the headline, so every session ends with a scored game you have to pass.",
};

const PATTERN_TITLE: Partial<Record<PatternKey, string>> = {
  hook: "Tame the hook",
  slice: "Kill the slice",
  fade: "Square the face",
  pull: "Start it on line",
  push: "Start it on line",
  fat: "Pure contact",
  thin: "Pure contact",
  contact: "Pure contact",
  short: "More distance",
  distance_control: "Dial your numbers",
  short_game: "Scoring zone",
  putting: "Roll it",
  driver: "Fix the driver",
  course_management: "Play smarter",
  nerves: "Perform under pressure",
};

function levelOk(d: Drill, exp: SurveyInput["experience"]) {
  if (d.level === "all") return true;
  if (!exp || exp === "INTERMEDIATE") return d.level !== "advanced";
  if (exp === "BEGINNER") return d.level === "beginner";
  return d.level !== "beginner";
}

// ───────────────────────── Player patterns ─────────────────────────
// Everything the member told us (issues + misses) plus what the launch
// monitor has confirmed, normalized to PatternKey so drills can be matched
// and — more importantly — ruled out.

const ISSUE_PATTERN: Record<string, PatternKey[]> = {
  slice: ["slice"],
  hook: ["hook"],
  fat_shots: ["fat"],
  thin_shots: ["thin"],
  inconsistent_contact: ["contact"],
  distance_control: ["distance_control"],
  short_game: ["short_game"],
  putting: ["putting"],
  driver: ["driver"],
  course_management: ["course_management"],
  nerves: ["nerves"],
};
const MISS_PATTERN: Record<string, PatternKey[]> = {
  slice: ["slice"],
  fade: ["fade"],
  hook: ["hook"],
  pull: ["pull"],
  push: ["push"],
  fat: ["fat"],
  thin: ["thin"],
  short: ["short"],
};

export type PlayerPattern = { key: PatternKey; strength: number; sources: string[] };

export function derivePatterns(survey: SurveyInput, flags: SwingFlag[]): PlayerPattern[] {
  const map = new Map<PatternKey, PlayerPattern>();
  const bump = (k: PatternKey, strength: number, source: string) => {
    const cur = map.get(k) ?? { key: k, strength: 0, sources: [] };
    cur.strength += strength;
    if (!cur.sources.includes(source)) cur.sources.push(source);
    map.set(k, cur);
  };
  for (const i of survey.issues) for (const k of ISSUE_PATTERN[i] ?? []) bump(k, 1, "issue");
  for (const m of survey.misses) for (const k of MISS_PATTERN[m] ?? []) bump(k, 0.7, "miss");
  for (const f of flags) {
    if (f.severity < 0.25) continue;
    const sev = Math.min(1, f.severity);
    if (f.key === "slice_driver") bump("slice", sev, "data");
    else if (f.key === "hook_driver") bump("hook", sev, "data");
    else if (f.key.startsWith("up_on_")) { bump("thin", sev * 0.6, "data"); bump("fat", sev * 0.6, "data"); }
    else if (f.key.startsWith("low_smash_")) bump("contact", sev, "data");
    else if (f.key.startsWith("carry_cv_") || f.key.startsWith("wedge_cv_") || f.key === "wedge_gapping") bump("distance_control", sev, "data");
    else if (f.key === "down_on_driver" || f.key === "high_spin_driver" || f.key === "low_launch_driver") bump("driver", sev * 0.8, "data");
    else if (f.key.startsWith("offline_") || f.key === "start_line_global") { bump("pull", sev * 0.4, "data"); bump("push", sev * 0.4, "data"); }
  }
  return [...map.values()].sort((a, b) => b.strength - a.strength);
}

const LEFT_CURVE: PatternKey[] = ["hook", "pull"];
const RIGHT_CURVE: PatternKey[] = ["slice", "fade", "push"];

/** Two-way miss: curves both ways → we won't rule out either family, we'll train face control. */
function isTwoWay(p: PlayerPattern[]) {
  const has = (keys: PatternKey[]) => p.some((x) => keys.includes(x.key) && x.strength >= 0.7);
  return has(LEFT_CURVE) && has(RIGHT_CURVE);
}

/**
 * Patterns a drill must not aggravate for this player. A two-way miss rules
 * out BOTH one-directional families (anti-slice and anti-hook drills) so the
 * plan falls back to neutral face-control work.
 */
function forbiddenFor(patterns: PlayerPattern[]): Set<PatternKey> {
  const out = new Set<PatternKey>();
  for (const p of patterns) if (p.strength >= 0.5) out.add(p.key);
  if (isTwoWay(patterns)) for (const k of [...LEFT_CURVE, ...RIGHT_CURVE]) out.add(k);
  return out;
}

function drillAllowed(d: Drill, forbidden: Set<PatternKey>) {
  return !(d.avoidFor ?? []).some((k) => forbidden.has(k));
}

/** How strongly a drill speaks to what this player reported. */
function patternBoost(d: Drill, patterns: PlayerPattern[]): { score: number; hits: PatternKey[] } {
  const hits: PatternKey[] = [];
  let score = 0;
  for (const k of d.fixes ?? []) {
    const p = patterns.find((x) => x.key === k);
    if (!p) continue;
    hits.push(k);
    score += 1.5 * Math.min(2, p.strength) + (p.sources.includes("data") ? 0.75 : 0);
  }
  return { score, hits };
}

function pickDrills(area: FocusAreaKey, exp: SurveyInput["experience"], used: Set<string>, flags: SwingFlag[], patterns: PlayerPattern[], forbidden: Set<PatternKey>, usedInPlan: Set<string> = new Set()): Array<{ d: Drill; hits: PatternKey[] }> {
  const primary = DRILLS.filter((d) => d.area === area && levelOk(d, exp) && d.key !== "warmup_sequence" && drillAllowed(d, forbidden));
  const secondary = DRILLS.filter((d) => d.also?.includes(area) && levelOk(d, exp) && d.key !== "warmup_sequence" && drillAllowed(d, forbidden));
  // Prefer drills that target an active flag's area/metric
  const flagKeys = new Set(flags.map((f) => f.key));
  const boost = (d: Drill) => {
    let b = 0;
    if (flagKeys.has("slice_driver") && ["anti_slice_towel", "split_hand_release", "face_to_path_ladder"].includes(d.key)) b += 2;
    if (flagKeys.has("hook_driver") && ["anti_hook_hold_off", "rotate_through_chest", "face_to_path_ladder", "grip_neutral_check"].includes(d.key)) b += 2;
    if ((flagKeys.has("high_spin_driver") || flagKeys.has("low_launch_driver") || flagKeys.has("down_on_driver")) && ["tee_height_launch", "driver_spin_window"].includes(d.key)) b += 2;
    if ([...flagKeys].some((k) => k.startsWith("low_smash_")) && ["smash_center_strike", "towel_low_point"].includes(d.key)) b += 2;
    if ([...flagKeys].some((k) => k.startsWith("up_on_")) && ["towel_low_point", "trail_foot_back", "weight_forward_strike"].includes(d.key)) b += 2;
    if ([...flagKeys].some((k) => k.startsWith("carry_cv_") || k.startsWith("wedge_cv_")) && ["wedge_clock", "ladder_contact_half_full", "random_yardage"].includes(d.key)) b += 2;
    if (flagKeys.has("wedge_gapping") && d.key === "gapping_session") b += 3;
    if ((flagKeys.has("start_line_global") || [...flagKeys].some((k) => k.startsWith("offline_"))) && ["nine_windows", "gate_tee_driver", "gate_putting_start_line", "start_line_stick"].includes(d.key)) b += 1.5;
    return b;
  };
  const score = (d: Drill, base: number) => {
    const pb = patternBoost(d, patterns);
    // Small variety nudge: a drill already in the week only repeats when it clearly wins.
    return { d, s: base + boost(d) + pb.score - (usedInPlan.has(d.key) ? 0.75 : 0), hits: pb.hits };
  };
  const ranked = [...primary.map((d) => score(d, 2)), ...secondary.map((d) => score(d, 1))].sort((a, b) => b.s - a.s);
  const out: Array<{ d: Drill; hits: PatternKey[] }> = [];
  for (const { d, hits } of ranked) {
    if (used.has(d.key)) continue;
    out.push({ d, hits });
  }
  return out;
}

const SESSION_TITLES: Record<FocusAreaKey, string> = {
  driver_accuracy: "Fairway finder",
  distance: "Speed day",
  iron_contact: "Strike it pure",
  distance_control: "Dial your numbers",
  short_game: "Scoring zone",
  putting: "Roll it",
  start_line: "Start it on line",
  spin_control: "Launch window",
  consistency: "Groove it",
  course_management: "Play the game",
};

export function generatePlan(survey: SurveyInput, flags: SwingFlag[], basis: { sessionsAnalyzed: number; shotsAnalyzed: number }): GeneratedPlan {
  const focus = scoreFocusAreas(survey, flags);
  const patterns = derivePatterns(survey, flags);
  const forbidden = forbiddenFor(patterns);
  const declared = patterns.filter((p) => p.sources.includes("issue") || p.sources.includes("miss"));
  const noteFor = (hits: PatternKey[]) => {
    const h = hits.filter((k) => patterns.some((p) => p.key === k && p.strength >= 0.5));
    if (!h.length) return undefined;
    return `For your ${h.slice(0, 2).map((k) => PATTERN_LABEL[k]).join(" & ")}`;
  };
  const sessions = Math.min(5, Math.max(1, survey.sessionsPerWeek ?? 2));
  const minutes = Math.min(120, Math.max(30, survey.minutesPerSession ?? 60));
  const top = focus.slice(0, Math.min(4, Math.max(2, sessions + 1)));

  const warmup = DRILLS.find((d) => d.key === "warmup_sequence")!;
  const transfer = [...DRILLS.filter((d) => d.area === "course_management" && levelOk(d, survey.experience)), DRILLS.find((d) => d.key === "pressure_streak")!];
  let transferIdx = 0;
  const schedule: PlanSession[] = [];
  const days = [1, 4, 2, 6, 3].slice(0, sessions).sort((a, b) => a - b); // Mon, Tue, Wed, Thu, Sat — spaced out
  const usedDrillSet = new Set<string>([warmup.key]);

  const maxPerArea = minutes >= 90 ? 3 : 2;
  for (let i = 0; i < sessions; i++) {
    const primary = top[i % top.length]!;
    const secondary = top[(i + 1) % top.length]!;
    const budget = minutes - warmup.minutes;
    const drills: PlanDrill[] = [{ key: warmup.key, minutes: warmup.minutes, area: "consistency" }];
    // Drills may repeat across the week (repetition is the point) but not
    // within a session; pickDrills nudges toward variety via usedDrillSet.
    const inSession = new Set<string>([warmup.key]);
    const take = (d: Drill, hits: PatternKey[], area: FocusAreaKey, mins: number, note?: string) => {
      drills.push({ key: d.key, minutes: mins, area, note: note ?? noteFor(hits) });
      inSession.add(d.key);
      usedDrillSet.add(d.key);
    };

    const want = [primary, secondary].filter((a, idx, arr) => arr.findIndex((x) => x.key === a.key) === idx);
    const split = want.length === 1 ? [1] : [0.65, 0.35];
    let carry = 0; // unspent minutes roll into the next area
    want.forEach((area, idx) => {
      let areaBudget = Math.round(budget * split[idx]!) + carry;
      const candidates = pickDrills(area.key, survey.experience, inSession, flags, patterns, forbidden, usedDrillSet);
      let count = 0;
      for (const { d, hits } of candidates) {
        if (areaBudget < Math.min(d.minutes, 8)) break;
        const mins = Math.min(d.minutes, areaBudget);
        take(d, hits, area.key, mins);
        areaBudget -= mins;
        if (++count >= maxPerArea) break;
      }
      carry = areaBudget;
    });

    // Finish with a transfer game when there's time — rotate so the same game
    // doesn't close every session.
    let leftover = minutes - drills.reduce((a, d) => a + d.minutes, 0);
    const games = transfer.filter((t) => !inSession.has(t.key));
    if (leftover >= 10 && games.length) {
      const game = games[transferIdx % games.length]!;
      transferIdx++;
      const gameMins = Math.min(Math.round(game.minutes * 1.5), Math.max(10, leftover));
      take(game, [], game.area, gameMins, "Transfer: make it count like the course.");
      leftover -= gameMins;
    }

    // Still time? Add more work in the session's areas before stretching anything.
    if (leftover >= 8) {
      for (const area of want) {
        for (const { d, hits } of pickDrills(area.key, survey.experience, inSession, flags, patterns, forbidden, usedDrillSet)) {
          if (leftover < 8) break;
          const mins = Math.min(d.minutes, leftover);
          take(d, hits, area.key, mins);
          leftover -= mins;
        }
      }
    }

    // Spend the last few minutes on the main drills (capped at 1.5× their
    // design length) so the session fills the time the member has.
    if (leftover > 0) {
      const mains = drills.filter((d) => d.area === primary.key && d.key !== warmup.key);
      for (const d of mains) {
        if (leftover <= 0) break;
        const cap = Math.round((DRILL_BY_KEY[d.key]?.minutes ?? d.minutes) * 1.5);
        const extra = Math.min(leftover, Math.max(0, cap - d.minutes));
        d.minutes += extra;
        leftover -= extra;
      }
      const game = drills.find((d) => d.note?.startsWith("Transfer"));
      if (leftover > 0 && game) game.minutes += leftover;
    }

    // Transfer game always closes the session.
    const gameIdx = drills.findIndex((d) => d.note?.startsWith("Transfer"));
    if (gameIdx >= 0 && gameIdx !== drills.length - 1) drills.push(...drills.splice(gameIdx, 1));

    schedule.push({
      day: days[i]!,
      title: SESSION_TITLES[primary.key],
      focus: want.map((a) => a.key),
      minutes: drills.reduce((a, d) => a + d.minutes, 0),
      drills,
    });
  }
  schedule.sort((a, b) => a.day - b.day);

  const drillDefs = DRILLS.filter((d) => usedDrillSet.has(d.key));
  const lead = top[0]!;
  const second = top[1];
  const hcText = survey.handicap != null ? `a ${survey.handicap} handicap` : survey.experience ? `a ${survey.experience.toLowerCase()} player` : "your game";
  const flagLine = flags.length ? ` Your swing data shows ${flags.slice(0, 2).map((f) => f.title.toLowerCase()).join(" and ")}, so those drills come first.` : " Import a GSPro session and the plan will re-tune itself around what the launch monitor sees.";
  const leadPattern = declared[0];
  const twoWay = isTwoWay(patterns);
  const issueLine = twoWay
    ? " You miss it both ways, so we've left out every one-directional fix (no anti-slice or anti-hook drills) and built the full-swing work around controlling the face: grip, start line and face-to-path."
    : leadPattern
      ? ` ${PATTERN_APPROACH[leadPattern.key]}`
      : "";
  const hasGames = schedule.some((s) => s.drills.some((d) => d.note?.startsWith("Transfer")));
  const summary = `Built for ${hcText}: ${sessions} session${sessions > 1 ? "s" : ""} a week, about ${minutes} minutes each.${issueLine} We're leading with ${lead.label.toLowerCase()}${second ? ` and ${second.label.toLowerCase()}` : ""}${hasGames ? ", and we close with a game so it transfers to the course" : ""}.${flagLine}`;

  return {
    title: twoWay ? "Control the face" : leadPattern && PATTERN_TITLE[leadPattern.key] ? PATTERN_TITLE[leadPattern.key]! : `${lead.label} plan`,
    summary,
    focusAreas: top,
    schedule,
    drills: drillDefs,
    basis: {
      surveyAt: new Date().toISOString(),
      sessionsAnalyzed: basis.sessionsAnalyzed,
      shotsAnalyzed: basis.shotsAnalyzed,
      flags: flags.slice(0, 8),
      handicap: survey.handicap ?? null,
      handedness: survey.handedness ?? null,
      patterns: patterns.slice(0, 6).map((p) => ({ key: p.key, label: PATTERN_LABEL[p.key], strength: Math.round(p.strength * 100) / 100, sources: p.sources })),
    },
  };
}
