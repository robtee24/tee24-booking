/**
 * Shared types for the drill bank. Kept separate from the bank files so they
 * can import types without a runtime cycle.
 */

export type FocusAreaKey =
  | "driver_accuracy"
  | "distance"
  | "iron_contact"
  | "distance_control"
  | "short_game"
  | "putting"
  | "start_line"
  | "spin_control"
  | "consistency"
  | "course_management";

export type DrillLevel = "all" | "beginner" | "intermediate" | "advanced";

/**
 * How a drill is practised. Mirrors the motor-learning literature the plan
 * engine is built on (blocked → variable → random/performance):
 *
 *  technical   blocked reps of one movement, usually with a constraint or
 *              feedback aid (towel, stick, gate, impact bag). Builds or
 *              changes a pattern. Low contextual interference.
 *  skill       variable / calibration practice with an outcome target:
 *              ladders, windows, random yardages, carry tolerances. Medium
 *              contextual interference; this is what retains.
 *  performance scored games with consequences that mimic the course:
 *              streaks, par-18, simulated holes, pressure tests. High
 *              contextual interference; this is what transfers.
 */
export type DrillMode = "technical" | "skill" | "performance";

/** Finer grouping so the engine (and admins) can see what a drill actually trains. */
export type DrillCategory =
  | "setup"
  | "grip"
  | "alignment"
  | "posture"
  | "takeaway"
  | "backswing"
  | "transition"
  | "path"
  | "face"
  | "release"
  | "low_point"
  | "strike"
  | "sequencing"
  | "tempo"
  | "speed"
  | "launch"
  | "trajectory"
  | "shaping"
  | "woods"
  | "wedge_distance"
  | "chipping"
  | "pitching"
  | "putting_stroke"
  | "putting_start_line"
  | "putting_speed"
  | "putting_short"
  | "green_reading"
  | "routine"
  | "strategy"
  | "pressure"
  | "warmup";

/**
 * Ball-flight / game patterns a member can report in the survey (issues,
 * misses, weak clubs) or that swing data can detect. Drills declare which
 * patterns they FIX and which they would make WORSE so the plan never hands
 * a hooker an anti-slice drill.
 */
export type PatternKey =
  // curvature / start direction
  | "slice"
  | "fade"
  | "hook"
  | "pull"
  | "push"
  // strike
  | "fat"
  | "thin"
  | "topping"
  | "shank"
  | "contact"
  // body / motion faults
  | "over_the_top"
  | "casting"
  | "sway"
  | "early_extension"
  | "tempo"
  | "alignment"
  // distance / control
  | "short"
  | "distance_control"
  // clubs
  | "driver"
  | "woods"
  | "long_irons"
  | "wedges"
  // scoring
  | "short_game"
  | "putting"
  | "three_putt"
  | "short_putts"
  | "course_management"
  | "nerves";

export const PATTERN_LABEL: Record<PatternKey, string> = {
  slice: "slice",
  fade: "weak fade",
  hook: "hook",
  pull: "pull",
  push: "push",
  fat: "fat shots",
  thin: "thin shots",
  topping: "topped shots",
  shank: "shanks",
  contact: "inconsistent contact",
  over_the_top: "over-the-top move",
  casting: "early release",
  sway: "sway",
  early_extension: "standing up through impact",
  tempo: "rushed tempo",
  alignment: "aim & alignment",
  short: "distance",
  distance_control: "distance control",
  driver: "driver",
  woods: "fairway woods & hybrids",
  long_irons: "long irons",
  wedges: "wedges",
  short_game: "short game",
  putting: "putting",
  three_putt: "three-putts",
  short_putts: "short putts",
  course_management: "course management",
  nerves: "pressure",
};

export type Drill = {
  key: string;
  title: string;
  area: FocusAreaKey;
  /** Secondary areas it also helps */
  also?: FocusAreaKey[];
  level: DrillLevel;
  minutes: number;
  clubs: string;
  equipment: string;
  setup: string;
  steps: string[];
  /** What “working” looks like on the launch monitor / in GSPro */
  successMetric: string;
  /** Short coaching cue */
  cue: string;
  /** Patterns this drill directly addresses (boosted when the member reports them). */
  fixes?: PatternKey[];
  /** Patterns this drill would aggravate — never prescribed to members who report them. */
  avoidFor?: PatternKey[];
  /** Practice mode — drives the technical/skill/performance split in each session. */
  mode: DrillMode;
  category: DrillCategory;
  /** Who teaches it / where it's documented. Every drill in the bank is attributed. */
  source: string;
  /** Illustration template key (defaults to `key`). Lets many drills share one figure. */
  figure?: string;
};

export const FOCUS_AREAS: Record<FocusAreaKey, { label: string; blurb: string }> = {
  driver_accuracy: { label: "Driver accuracy", blurb: "Tighter dispersion off the tee so you're hitting approaches from the fairway." },
  distance: { label: "Distance & speed", blurb: "More ball speed through better contact, launch and a faster, more efficient swing." },
  iron_contact: { label: "Iron contact", blurb: "Ball-first strikes with a consistent low point — no more fat or thin shots." },
  distance_control: { label: "Distance control", blurb: "Predictable carry numbers with every club so you can pick a yardage and hit it." },
  short_game: { label: "Short game", blurb: "Chipping and pitching that gets up-and-down instead of leaving 20-footers." },
  putting: { label: "Putting", blurb: "Lag speed and start line so three-putts disappear." },
  start_line: { label: "Start line & face control", blurb: "Starting the ball where you aim by controlling the clubface at impact." },
  spin_control: { label: "Launch & spin window", blurb: "Launch angle and spin numbers that maximize carry and keep the ball in play." },
  consistency: { label: "Consistency", blurb: "Repeatable contact and tempo so your good shots show up more often." },
  course_management: { label: "Course management", blurb: "Smarter targets, club choices and a pre-shot routine that lowers scores immediately." },
};

export const MODE_LABEL: Record<DrillMode, string> = {
  technical: "Technique",
  skill: "Skill",
  performance: "Game",
};
