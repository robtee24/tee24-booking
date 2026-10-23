/**
 * Builds a personalized practice plan from the survey (goals, misses, weak
 * clubs, time budget) and whatever swing data has been imported.
 *
 * Deterministic rules, no model calls: every weight is explainable and the
 * plan re-scores itself as new sessions arrive (flags shift the weights).
 */
import { DRILLS, FOCUS_AREAS, type Drill, type FocusAreaKey } from "./drills";
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
    add(w, ISSUE_W[i]!);
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
  basis: { surveyAt: string; sessionsAnalyzed: number; shotsAnalyzed: number; flags: SwingFlag[]; handicap: number | null };
};

function levelOk(d: Drill, exp: SurveyInput["experience"]) {
  if (d.level === "all") return true;
  if (!exp || exp === "INTERMEDIATE") return d.level !== "advanced";
  if (exp === "BEGINNER") return d.level === "beginner";
  return d.level !== "beginner";
}

function pickDrills(area: FocusAreaKey, exp: SurveyInput["experience"], used: Set<string>, flags: SwingFlag[]): Drill[] {
  const primary = DRILLS.filter((d) => d.area === area && levelOk(d, exp) && d.key !== "warmup_sequence");
  const secondary = DRILLS.filter((d) => d.also?.includes(area) && levelOk(d, exp) && d.key !== "warmup_sequence");
  // Prefer drills that target an active flag's area/metric
  const flagKeys = new Set(flags.map((f) => f.key));
  const boost = (d: Drill) => {
    let b = 0;
    if (flagKeys.has("slice_driver") && ["anti_slice_towel", "split_hand_release", "face_to_path_ladder"].includes(d.key)) b += 2;
    if (flagKeys.has("hook_driver") && ["face_to_path_ladder", "gate_tee_driver", "nine_windows"].includes(d.key)) b += 2;
    if ((flagKeys.has("high_spin_driver") || flagKeys.has("low_launch_driver") || flagKeys.has("down_on_driver")) && ["tee_height_launch", "driver_spin_window"].includes(d.key)) b += 2;
    if ([...flagKeys].some((k) => k.startsWith("low_smash_")) && ["smash_center_strike", "towel_low_point"].includes(d.key)) b += 2;
    if ([...flagKeys].some((k) => k.startsWith("up_on_")) && ["towel_low_point", "trail_foot_back"].includes(d.key)) b += 2;
    if ([...flagKeys].some((k) => k.startsWith("carry_cv_") || k.startsWith("wedge_cv_")) && ["wedge_clock", "ladder_contact_half_full", "random_yardage"].includes(d.key)) b += 2;
    if (flagKeys.has("wedge_gapping") && d.key === "gapping_session") b += 3;
    if ((flagKeys.has("start_line_global") || [...flagKeys].some((k) => k.startsWith("offline_"))) && ["nine_windows", "gate_tee_driver", "gate_putting_start_line"].includes(d.key)) b += 1.5;
    return b;
  };
  const ranked = [...primary.map((d) => ({ d, s: 2 + boost(d) })), ...secondary.map((d) => ({ d, s: 1 + boost(d) }))].sort((a, b) => b.s - a.s);
  const out: Drill[] = [];
  for (const { d } of ranked) {
    if (used.has(d.key)) continue;
    out.push(d);
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
  const sessions = Math.min(5, Math.max(1, survey.sessionsPerWeek ?? 2));
  const minutes = Math.min(120, Math.max(30, survey.minutesPerSession ?? 60));
  const top = focus.slice(0, Math.min(4, Math.max(2, sessions + 1)));

  const warmup = DRILLS.find((d) => d.key === "warmup_sequence")!;
  const transfer = DRILLS.filter((d) => d.area === "course_management");
  const used = new Set<string>();
  const schedule: PlanSession[] = [];
  const dayMap = [1, 4, 2, 6, 3]; // Mon, Thu, Tue, Sat, Wed — spaced out
  const usedDrillSet = new Set<string>([warmup.key]);

  for (let i = 0; i < sessions; i++) {
    const primary = top[i % top.length]!;
    const secondary = top[(i + 1) % top.length]!;
    const budget = minutes - warmup.minutes;
    const drills: PlanDrill[] = [{ key: warmup.key, minutes: warmup.minutes, area: "consistency" }];
    let left = budget;

    const want = [primary, secondary].filter((a, idx, arr) => arr.findIndex((x) => x.key === a.key) === idx);
    const split = want.length === 1 ? [1] : [0.65, 0.35];
    want.forEach((area, idx) => {
      let areaBudget = Math.round(left * split[idx]!);
      const candidates = pickDrills(area.key, survey.experience, used, flags);
      for (const d of candidates) {
        if (areaBudget < Math.min(d.minutes, 8)) break;
        const mins = Math.min(d.minutes, areaBudget);
        drills.push({ key: d.key, minutes: mins, area: area.key });
        used.add(d.key);
        usedDrillSet.add(d.key);
        areaBudget -= mins;
        if (drills.filter((x) => x.area === area.key).length >= 2) break;
      }
      left -= Math.round(budget * split[idx]!) - areaBudget;
    });

    // Finish with a transfer game when there's time (every other session at least).
    const leftover = minutes - drills.reduce((a, d) => a + d.minutes, 0);
    if (leftover >= 10) {
      const game = transfer.find((t) => !usedDrillSet.has(t.key) && t.minutes <= Math.max(leftover, 15)) ?? DRILLS.find((d) => d.key === "pressure_streak")!;
      drills.push({ key: game.key, minutes: Math.min(game.minutes, Math.max(10, leftover)), area: game.area, note: "Transfer: make it count like the course." });
      usedDrillSet.add(game.key);
    }
    // Rotate so later sessions don't reuse the same primary drills (reset after each session for variety across weeks)
    if (i % 2 === 1) used.clear();

    schedule.push({
      day: dayMap[i]!,
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
  const hcText = survey.handicap != null ? `a ${survey.handicap} handicap` : survey.experience ? `${survey.experience.toLowerCase()} player` : "your game";
  const flagLine = flags.length ? ` Your swing data shows ${flags.slice(0, 2).map((f) => f.title.toLowerCase()).join(" and ")}, so those drills come first.` : " Import a GSPro session and the plan will re-tune itself around what the launch monitor sees.";
  const summary = `Built for ${hcText}: ${sessions} session${sessions > 1 ? "s" : ""} a week, about ${minutes} minutes each. We're leading with ${lead.label.toLowerCase()}${second ? ` and ${second.label.toLowerCase()}` : ""}, finishing each session with a game so it transfers to the course.${flagLine}`;

  return {
    title: `${lead.label} plan`,
    summary,
    focusAreas: top,
    schedule,
    drills: drillDefs,
    basis: { surveyAt: new Date().toISOString(), sessionsAnalyzed: basis.sessionsAnalyzed, shotsAnalyzed: basis.shotsAnalyzed, flags: flags.slice(0, 8), handicap: survey.handicap ?? null },
  };
}
