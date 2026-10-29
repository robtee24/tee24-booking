/**
 * Builds a personalized practice plan from the survey (goals, misses, weak
 * clubs, time budget) and whatever swing data has been imported.
 *
 * Deterministic rules, no model calls: every weight is explainable and the
 * plan re-scores itself as new sessions arrive (flags shift the weights).
 *
 * Session structure follows the motor-learning evidence on practice mix:
 *   - Blocked technical reps build or change a movement but retain poorly on
 *     their own; variable/random practice feels worse in the session but
 *     retains and transfers better (contextual-interference effect; Porter &
 *     Magill 2010; 2024 systematic review, PMC10899359).
 *   - Novices do best with *increasing* interference — blocked first, then
 *     variable, then random — so beginners get a bigger technical block and
 *     the ratio tilts toward skill/performance as the player improves.
 *   - Adam Young's "technical → skill → performance" session shape, with
 *     tasks pitched at ~70% success.
 *   - Mark Broadie's strokes-gained data decides *where* the minutes go for a
 *     given handicap: approach play (100–175 yd) is the biggest leak for 90s
 *     golfers, then 3–10 ft putts and 0–60 yd shots.
 */
import { DRILL_BY_KEY, DRILLS, FOCUS_AREAS, MODE_LABEL, PATTERN_LABEL, type Drill, type DrillMode, type FocusAreaKey, type PatternKey } from "./drills";
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
    { key: "shank", label: "Shanks" },
    { key: "inconsistent_contact", label: "Contact is all over the place" },
    { key: "tempo", label: "Quick / rushed tempo" },
    { key: "alignment", label: "Aim & alignment" },
    { key: "distance_control", label: "Can't control distance" },
    { key: "short_game", label: "Chipping / pitching" },
    { key: "three_putts", label: "Three-putts / lag speed" },
    { key: "short_putts", label: "Missing short putts" },
    { key: "putting", label: "Putting in general" },
    { key: "driver", label: "Driver is a liability" },
    { key: "woods", label: "Fairway woods / hybrids" },
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
    { key: "top", label: "Topped" },
    { key: "shank", label: "Shank" },
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
  break_90: { distance_control: 2, short_game: 1.5, course_management: 1.5, putting: 1.5, driver_accuracy: 1 },
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
  shank: { iron_contact: 3, consistency: 0.5 },
  inconsistent_contact: { iron_contact: 2, consistency: 2 },
  tempo: { consistency: 2.5, distance: 0.5 },
  alignment: { start_line: 2, course_management: 1 },
  distance_control: { distance_control: 3 },
  short_game: { short_game: 3 },
  three_putts: { putting: 3 },
  short_putts: { putting: 3 },
  putting: { putting: 3 },
  driver: { driver_accuracy: 2, spin_control: 1 },
  woods: { iron_contact: 1.5, consistency: 1, distance: 0.5 },
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
  top: { iron_contact: 2 },
  shank: { iron_contact: 2 },
  short: { distance: 1, distance_control: 1 },
};

function add(w: Weights, part: Partial<Weights>, scale = 1) {
  for (const [k, v] of Object.entries(part) as [FocusAreaKey, number][]) w[k] += v * scale;
}

export type FocusArea = { key: FocusAreaKey; label: string; blurb: string; weight: number; reasons: string[] };

function effectiveHandicap(survey: SurveyInput) {
  return survey.handicap ?? (survey.experience === "BEGINNER" ? 28 : survey.experience === "ADVANCED" ? 8 : 18);
}

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

  // Handicap priors from strokes-gained data (Broadie, "Every Shot Counts"):
  //  100+ shooters: penalty shots and poor contact dominate → contact + decisions.
  //  90s: approach play 100–175 yd is the single biggest leak, then 3–10 ft
  //       putts and 0–60 yd shots.
  //  80s: approach precision, putting from 3–10 ft, driving distance.
  //  70s: distance control, driving, putting — the margins are small everywhere.
  const hc = effectiveHandicap(survey);
  if (hc >= 25) {
    add(w, { iron_contact: 1.5, course_management: 1.25, short_game: 0.75, putting: 0.5 });
    tag({ iron_contact: 0, course_management: 0 }, "Strokes-gained: at this level contact and avoiding penalty shots lower scores fastest");
  } else if (hc >= 15) {
    add(w, { distance_control: 1.25, short_game: 1, putting: 0.75, driver_accuracy: 0.5 });
    tag({ distance_control: 0 }, "Strokes-gained: 90s golfers lose most on 100–175 yd approaches");
  } else if (hc >= 8) {
    add(w, { distance_control: 1.25, putting: 0.75, start_line: 0.5, distance: 0.5 });
    tag({ distance_control: 0, putting: 0 }, "Strokes-gained: approach precision and 3–10 ft putts separate 80s from 70s");
  } else {
    add(w, { distance_control: 1, spin_control: 0.5, putting: 0.75, distance: 0.75 });
  }

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

export type PlanDrill = { key: string; minutes: number; area: FocusAreaKey; mode: DrillMode; note?: string };
export type ModeMinutes = Record<DrillMode, number>;
export type PlanSession = {
  day: number;
  title: string;
  focus: FocusAreaKey[];
  minutes: number;
  drills: PlanDrill[];
  /** Minutes spent in each practice mode (warm-up counts as technical). */
  mix: ModeMinutes;
};

export type ModeMix = Record<DrillMode, number>;

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
    /** Target technical / skill / performance split (fractions of session time) and why. */
    mix: ModeMix;
    mixReasons: string[];
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
  topping: "Topped shots are the headline, so the drills keep your posture through impact and move the low point in front of the ball.",
  shank: "Shanks are the headline, so the drills get the club returning to the center of the face — path, posture and a hosel-proof setup — before anything else.",
  contact: "Contact is the headline, so the drills groove one low point and one tempo before we chase anything else.",
  over_the_top: "The over-the-top move is the headline, so the drills shallow the transition and get the club approaching from inside.",
  casting: "You're releasing the club early, so the drills hold the angle longer and move the low point forward.",
  sway: "Lateral sway is the headline, so the drills turn around a stable trail leg instead of sliding off the ball.",
  early_extension: "Standing up through impact is the headline, so the drills keep your hips back and your chest over the ball.",
  tempo: "Tempo is the headline, so every full-swing block starts with rhythm work before we add speed or targets.",
  alignment: "Aim is the headline, so every drill uses an alignment station and a pre-shot routine with an intermediate target.",
  short: "You want more distance, so we're building speed on top of center-face contact and a better launch window.",
  distance_control: "Distance control is the headline: gapping, the clock system and random-yardage games so you can pick a number and hit it.",
  driver: "Driver is the headline, so we're fixing the tee shot first — face control, strike and launch — before anything else.",
  woods: "Fairway woods and hybrids are the headline, so the strike work is about sweeping the ball off the turf with a shallow low point.",
  long_irons: "Long irons are the headline, so the strike work is about launch and center-face contact with the longer clubs.",
  wedges: "Wedges are the headline: partial-swing distance control and strike with the scoring clubs.",
  short_game: "Up-and-downs are the headline, so chipping and pitching get the biggest share of every session.",
  putting: "Putting is the headline: speed first, then start line, then pressure.",
  three_putt: "Three-putts are the headline, so lag speed from 25–50 ft leads every putting block.",
  short_putts: "Short putts are the headline, so start line and pressure makes from 3–8 ft lead every putting block.",
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
  topping: "Pure contact",
  shank: "Find the center",
  contact: "Pure contact",
  over_the_top: "Shallow it out",
  casting: "Hold the angle",
  sway: "Turn, don't slide",
  early_extension: "Stay in posture",
  tempo: "Find your rhythm",
  alignment: "Aim it right",
  short: "More distance",
  distance_control: "Dial your numbers",
  driver: "Fix the driver",
  woods: "Sweep the woods",
  long_irons: "Long-iron launch",
  wedges: "Own your wedges",
  short_game: "Scoring zone",
  putting: "Roll it",
  three_putt: "No more three-putts",
  short_putts: "Make the short ones",
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
// Everything the member told us (issues + misses + weak clubs) plus what the
// launch monitor has confirmed, normalized to PatternKey so drills can be
// matched and — more importantly — ruled out.

const ISSUE_PATTERN: Record<string, PatternKey[]> = {
  slice: ["slice"],
  hook: ["hook"],
  fat_shots: ["fat"],
  thin_shots: ["thin", "topping"],
  shank: ["shank", "contact"],
  inconsistent_contact: ["contact"],
  tempo: ["tempo"],
  alignment: ["alignment"],
  distance_control: ["distance_control"],
  short_game: ["short_game"],
  three_putts: ["three_putt", "putting"],
  short_putts: ["short_putts", "putting"],
  putting: ["putting"],
  driver: ["driver"],
  woods: ["woods"],
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
  top: ["topping"],
  shank: ["shank"],
  short: ["short"],
};
const CLUB_PATTERN: Record<string, PatternKey[]> = {
  driver: ["driver"],
  woods: ["woods"],
  long_irons: ["long_irons"],
  wedges: ["wedges"],
  putter: ["putting"],
};
const GOAL_PATTERN: Record<string, PatternKey[]> = {
  more_distance: ["short"],
  fewer_putts: ["putting"],
  better_short_game: ["short_game"],
  league_ready: ["nerves"],
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
  for (const c of survey.weakClubs) for (const k of CLUB_PATTERN[c] ?? []) bump(k, 0.6, "club");
  for (const g of survey.goals) for (const k of GOAL_PATTERN[g] ?? []) bump(k, 0.4, "goal");
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

// ───────────────────────── Practice mix ─────────────────────────

type Level = "BEGINNER" | "INTERMEDIATE" | "ADVANCED";

/**
 * Baseline technical / skill / performance split by level. Novices benefit
 * from more blocked work first (increasing contextual interference);
 * experienced players retain more from variable and pressure practice.
 */
const LEVEL_MIX: Record<Level, ModeMix> = {
  BEGINNER: { technical: 0.5, skill: 0.3, performance: 0.2 },
  INTERMEDIATE: { technical: 0.35, skill: 0.4, performance: 0.25 },
  ADVANCED: { technical: 0.25, skill: 0.4, performance: 0.35 },
};

const MECHANICAL: PatternKey[] = ["slice", "hook", "pull", "push", "fat", "thin", "topping", "shank", "over_the_top", "casting", "sway", "early_extension", "tempo", "alignment"];
const PRESSURE: PatternKey[] = ["nerves", "course_management"];

function levelFor(survey: SurveyInput): Level {
  if (survey.experience) return survey.experience;
  const hc = effectiveHandicap(survey);
  return hc >= 20 ? "BEGINNER" : hc >= 10 ? "INTERMEDIATE" : "ADVANCED";
}

function normalize(mix: ModeMix): ModeMix {
  const floor = 0.1;
  const t = Math.max(floor, mix.technical), s = Math.max(floor, mix.skill), p = Math.max(floor, mix.performance);
  const sum = t + s + p;
  return { technical: t / sum, skill: s / sum, performance: p / sum };
}

/** Plan-level target mix with the reasons we moved off the baseline. */
export function modeMixFor(survey: SurveyInput, patterns: PlayerPattern[], flags: SwingFlag[]): { mix: ModeMix; reasons: string[]; level: Level } {
  const level = levelFor(survey);
  const base = LEVEL_MIX[level];
  const mix: ModeMix = { ...base };
  const reasons: string[] = [];
  reasons.push(
    level === "BEGINNER"
      ? "Newer players learn fastest by building one move with blocked reps first, then testing it under variety."
      : level === "ADVANCED"
        ? "Experienced players retain more from variable and scored practice than from technical reps."
        : "A balanced split: enough technical work to change a pattern, enough variety and pressure for it to stick on the course.",
  );

  const strongMechanical = patterns.some((p) => MECHANICAL.includes(p.key) && p.strength >= 1) || flags.some((f) => f.severity >= 0.5 && (["slice_driver", "hook_driver", "down_on_driver"].includes(f.key) || f.key.startsWith("up_on_") || f.key.startsWith("low_smash_")));
  if (strongMechanical) {
    mix.technical += 0.1;
    mix.skill -= 0.05;
    mix.performance -= 0.05;
    reasons.push("A clear swing pattern to fix, so technical reps get an extra 10%.");
  }
  const pressureGoal = patterns.some((p) => PRESSURE.includes(p.key) && p.strength >= 0.5) || survey.goals.includes("league_ready");
  if (pressureGoal) {
    mix.performance += 0.1;
    mix.technical -= 0.05;
    mix.skill -= 0.05;
    reasons.push("Pressure and decision-making are on your list, so scored games get an extra 10%.");
  }
  return { mix: normalize(mix), reasons, level };
}

/** Per-session mix: ramps toward performance across the week (blocked → random). */
function sessionMix(plan: ModeMix, idx: number, total: number): ModeMix {
  if (total <= 1) return plan;
  const shift = 0.04 * (idx - (total - 1) / 2);
  return normalize({ technical: plan.technical - shift, skill: plan.skill, performance: plan.performance + shift });
}

// ───────────────────────── Drill selection ─────────────────────────

type Ranked = { d: Drill; s: number; hits: PatternKey[] };

const flagBoost = (d: Drill, flagKeys: Set<string>) => {
  let b = 0;
  if (flagKeys.has("slice_driver") && ["anti_slice_towel", "split_hand_release", "face_to_path_ladder", "headcover_path_drill", "two_stick_channel"].includes(d.key)) b += 2;
  if (flagKeys.has("hook_driver") && ["anti_hook_hold_off", "rotate_through_chest", "face_to_path_ladder", "grip_neutral_check", "two_tee_square_face"].includes(d.key)) b += 2;
  if ((flagKeys.has("high_spin_driver") || flagKeys.has("low_launch_driver") || flagKeys.has("down_on_driver")) && ["tee_height_launch", "driver_spin_window", "driver_head_behind_ball", "tee_behind_ball_upswing"].includes(d.key)) b += 2;
  if ([...flagKeys].some((k) => k.startsWith("low_smash_")) && ["smash_center_strike", "towel_low_point", "face_spray_map"].includes(d.key)) b += 2;
  if ([...flagKeys].some((k) => k.startsWith("up_on_")) && ["towel_low_point", "trail_foot_back", "weight_forward_strike", "three_tee_low_point", "line_divot_drill"].includes(d.key)) b += 2;
  if ([...flagKeys].some((k) => k.startsWith("carry_cv_") || k.startsWith("wedge_cv_")) && ["wedge_clock", "ladder_contact_half_full", "random_yardage", "carry_tolerance_test"].includes(d.key)) b += 2;
  if (flagKeys.has("wedge_gapping") && d.key === "gapping_session") b += 3;
  if ((flagKeys.has("start_line_global") || [...flagKeys].some((k) => k.startsWith("offline_"))) && ["nine_windows", "gate_tee_driver", "gate_putting_start_line", "start_line_stick", "kenyon_gate_5cm"].includes(d.key)) b += 1.5;
  return b;
};

/**
 * Candidates for one session block: drills of `mode` in the session's areas
 * (primary first, secondary next, `also` matches last), ranked by how well
 * they speak to the member's patterns and swing flags.
 */
function rankCandidates(opts: {
  areas: FocusAreaKey[];
  /** Other focus areas in the plan — used when the session's areas have nothing left in this mode. */
  fallbackAreas: FocusAreaKey[];
  mode: DrillMode;
  exp: SurveyInput["experience"];
  exclude: Set<string>;
  flags: SwingFlag[];
  patterns: PlayerPattern[];
  forbidden: Set<PatternKey>;
  usedCount: Map<string, number>;
}): Ranked[] {
  const { areas, fallbackAreas, mode, exp, exclude, flags, patterns, forbidden, usedCount } = opts;
  const flagKeys = new Set(flags.map((f) => f.key));
  const ok = (d: Drill) => d.mode === mode && levelOk(d, exp) && d.key !== "warmup_sequence" && drillAllowed(d, forbidden) && !exclude.has(d.key);
  const out: Ranked[] = [];
  const seen = new Set<string>();
  const push = (d: Drill, base: number) => {
    if (seen.has(d.key)) return;
    seen.add(d.key);
    const pb = patternBoost(d, patterns);
    // Variety nudge: a drill already in the week only repeats when it clearly wins,
    // and each repeat makes the next one less likely.
    out.push({ d, s: base + flagBoost(d, flagKeys) + pb.score - 0.9 * (usedCount.get(d.key) ?? 0), hits: pb.hits });
  };
  const collect = (list: FocusAreaKey[], top: number) => {
    list.forEach((area, idx) => {
      const base = idx === 0 ? top : top - 0.75;
      for (const d of DRILLS) if (ok(d) && d.area === area) push(d, base);
      for (const d of DRILLS) if (ok(d) && d.also?.includes(area)) push(d, base - 0.75);
    });
  };
  collect(areas, 2);
  if (!out.length) collect(fallbackAreas.filter((a) => !areas.includes(a)), 0.75);
  if (!out.length) for (const d of DRILLS) if (ok(d)) push(d, 0);
  return out.sort((a, b) => b.s - a.s);
}

/** Generic closers when the session's areas have no performance drill left. */
function transferGames(exp: SurveyInput["experience"], forbidden: Set<PatternKey>, exclude: Set<string>) {
  return DRILLS.filter((d) => d.mode === "performance" && (d.area === "course_management" || d.category === "pressure") && levelOk(d, exp) && drillAllowed(d, forbidden) && !exclude.has(d.key) && d.minutes <= 25);
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

const MODE_ORDER: DrillMode[] = ["technical", "skill", "performance"];

export function generatePlan(survey: SurveyInput, flags: SwingFlag[], basis: { sessionsAnalyzed: number; shotsAnalyzed: number }): GeneratedPlan {
  const focus = scoreFocusAreas(survey, flags);
  const patterns = derivePatterns(survey, flags);
  const forbidden = forbiddenFor(patterns);
  const declared = patterns.filter((p) => p.sources.includes("issue") || p.sources.includes("miss"));
  const { mix: planMix, reasons: mixReasons, level } = modeMixFor(survey, patterns, flags);
  const noteFor = (hits: PatternKey[]) => {
    const h = hits.filter((k) => patterns.some((p) => p.key === k && p.strength >= 0.5));
    if (!h.length) return undefined;
    return `For your ${h.slice(0, 2).map((k) => PATTERN_LABEL[k]).join(" & ")}`;
  };
  const sessions = Math.min(5, Math.max(1, survey.sessionsPerWeek ?? 2));
  const minutes = Math.min(120, Math.max(30, survey.minutesPerSession ?? 60));
  const top = focus.slice(0, Math.min(4, Math.max(2, sessions + 1)));

  const warmup = DRILLS.find((d) => d.key === "warmup_sequence")!;
  let transferIdx = 0;
  const schedule: PlanSession[] = [];
  const days = [1, 4, 2, 6, 3].slice(0, sessions).sort((a, b) => a - b); // Mon, Tue, Wed, Thu, Sat — spaced out
  const usedDrillSet = new Set<string>([warmup.key]);
  const usedCount = new Map<string, number>();
  const topKeys = top.map((a) => a.key);

  for (let i = 0; i < sessions; i++) {
    const primary = top[i % top.length]!;
    const secondary = top[(i + 1) % top.length]!;
    const areas = [primary, secondary].filter((a, idx, arr) => arr.findIndex((x) => x.key === a.key) === idx).map((a) => a.key);
    const mix = sessionMix(planMix, i, sessions);
    const warmMins = Math.min(warmup.minutes, Math.max(5, Math.round(minutes * 0.12)));
    const budget = minutes - warmMins;
    const drills: PlanDrill[] = [{ key: warmup.key, minutes: warmMins, area: "consistency", mode: "technical" }];
    const inSession = new Set<string>([warmup.key]);
    const take = (d: Drill, hits: PatternKey[], mins: number, note?: string) => {
      const area = areas.includes(d.area) ? d.area : (d.also?.find((a) => areas.includes(a)) ?? d.area);
      drills.push({ key: d.key, minutes: mins, area, mode: d.mode, note: note ?? noteFor(hits) });
      inSession.add(d.key);
      usedDrillSet.add(d.key);
      usedCount.set(d.key, (usedCount.get(d.key) ?? 0) + 1);
    };

    // Block budgets. Short sessions still get a game: performance never drops below 10 min when the session is ≥ 40.
    const target: ModeMinutes = {
      technical: Math.round(budget * mix.technical),
      skill: Math.round(budget * mix.skill),
      performance: 0,
    };
    target.performance = budget - target.technical - target.skill;
    if (minutes >= 40 && target.performance < 10) {
      const need = 10 - target.performance;
      target.technical -= Math.ceil(need / 2);
      target.skill -= Math.floor(need / 2);
      target.performance = 10;
    }
    // Drills per block scale with the block length (≈ one drill per 10–12 min, cap 4).
    const capFor = (mins: number) => Math.max(1, Math.min(4, Math.round(mins / 11)));

    let carry = 0;
    for (const mode of MODE_ORDER) {
      let blockBudget = target[mode] + carry;
      carry = 0;
      if (blockBudget < 5) { carry = blockBudget; continue; }
      let candidates = rankCandidates({ areas, fallbackAreas: topKeys, mode, exp: survey.experience, exclude: inSession, flags, patterns, forbidden, usedCount });
      if (mode === "performance") {
        // If nothing in the session's areas speaks to the player's patterns, close with a rotating transfer game instead.
        const bestIsRelevant = candidates[0] && (candidates[0].hits.length > 0 || candidates[0].s >= 1.25);
        if (!bestIsRelevant) {
          const games = transferGames(survey.experience, forbidden, inSession);
          if (games.length) {
            candidates = [{ d: games[transferIdx % games.length]!, s: 0, hits: [] }, ...candidates];
            transferIdx++;
          }
        }
      }
      const cap = mode === "performance" ? Math.min(2, capFor(blockBudget)) : capFor(blockBudget);
      const taken: PlanDrill[] = [];
      for (const { d, hits } of candidates) {
        if (taken.length >= cap) break;
        // First drill in a block always fits (≥5 min); later ones need ≥8 min or their design length.
        const minLen = taken.length ? Math.min(d.minutes, 8) : 5;
        if (blockBudget < minLen) break;
        const mins = Math.min(d.minutes, blockBudget);
        take(d, hits, mins, mode === "performance" ? `Game: ${noteFor(hits)?.toLowerCase() ?? "make it count like the course."}` : undefined);
        taken.push(drills[drills.length - 1]!);
        blockBudget -= mins;
      }
      // Spend what's left in this block on its own drills (≤ 1.5× design length;
      // games can run to 2× since nothing follows them).
      const stretch = mode === "performance" ? 2 : 1.5;
      for (const pd of taken) {
        if (blockBudget <= 0) break;
        const cap15 = Math.round((DRILL_BY_KEY[pd.key]?.minutes ?? pd.minutes) * stretch);
        const extra = Math.min(blockBudget, Math.max(0, cap15 - pd.minutes));
        pd.minutes += extra;
        blockBudget -= extra;
      }
      carry = blockBudget;
    }

    // Anything still unspent tops up the games (they're usually under target), then the primary-area drills.
    let leftover = minutes - drills.reduce((a, d) => a + d.minutes, 0);
    if (leftover > 0) {
      const order = [...drills.filter((d) => d.mode === "performance"), ...drills.filter((d) => d.mode !== "performance" && d.area === primary.key && d.key !== warmup.key)];
      for (const pd of order) {
        if (leftover <= 0) break;
        const cap2 = Math.round((DRILL_BY_KEY[pd.key]?.minutes ?? pd.minutes) * 2);
        const extra = Math.min(leftover, Math.max(0, cap2 - pd.minutes));
        pd.minutes += extra;
        leftover -= extra;
      }
      const last = drills[drills.length - 1]!;
      if (leftover > 0 && last.key !== warmup.key) last.minutes += leftover;
    }

    const mixMinutes: ModeMinutes = { technical: 0, skill: 0, performance: 0 };
    for (const d of drills) mixMinutes[d.mode] += d.minutes;

    schedule.push({
      day: days[i]!,
      title: SESSION_TITLES[primary.key],
      focus: areas,
      minutes: drills.reduce((a, d) => a + d.minutes, 0),
      drills,
      mix: mixMinutes,
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
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const mixLine = ` Each session runs warm-up → ${MODE_LABEL.technical.toLowerCase()} (${pct(planMix.technical)}) → ${MODE_LABEL.skill.toLowerCase()} (${pct(planMix.skill)}) → ${MODE_LABEL.performance.toLowerCase()} (${pct(planMix.performance)})${sessions > 1 ? ", tilting toward games as the week goes on" : ""}. ${mixReasons[0] ?? ""}`;
  const summary = `Built for ${hcText}: ${sessions} session${sessions > 1 ? "s" : ""} a week, about ${minutes} minutes each.${issueLine} We're leading with ${lead.label.toLowerCase()}${second ? ` and ${second.label.toLowerCase()}` : ""}.${mixLine}${flagLine}`;

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
      mix: { technical: Math.round(planMix.technical * 100) / 100, skill: Math.round(planMix.skill * 100) / 100, performance: Math.round(planMix.performance * 100) / 100 },
      mixReasons: [...mixReasons, `Level: ${level.toLowerCase()}.`],
    },
  };
}
