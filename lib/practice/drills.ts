/**
 * Drill library for the Game Improvement module.
 *
 * Every drill is tagged with the focus area it trains, the launch-monitor
 * metric that proves it is working, and a level. The plan engine picks
 * drills by area weight, level and the member's available minutes; the app
 * renders them with setup → steps → success metric.
 *
 * Designed for a Tee24 bay: launch monitor + GSPro, member brings own balls,
 * alignment sticks/tees/towel are the only props assumed.
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

export const DRILLS: Drill[] = [
  // ───────────────────────── Driver accuracy / start line ─────────────────────────
  {
    key: "gate_tee_driver",
    title: "Gate tees",
    area: "driver_accuracy",
    also: ["start_line"],
    level: "all",
    minutes: 10,
    clubs: "Driver",
    equipment: "3 tees",
    setup: "Tee the ball normally. Push two extra tees into the mat just outside the toe and heel of the clubhead, half a clubhead apart from each edge.",
    steps: ["Make 5 slow half-speed swings without a ball, missing both gate tees.", "Hit 10 drives at 80% speed. If you clip a gate tee, note which side.", "Finish with 5 full-speed drives through the gate."],
    successMetric: "Launch Direction within ±4° on 7 of 10 shots; Offline under 20 yd.",
    cue: "Swing the center of the face through the gate — not the ball.",
  },
  {
    key: "nine_windows",
    title: "Nine windows",
    area: "start_line",
    also: ["driver_accuracy", "course_management"],
    level: "intermediate",
    minutes: 15,
    clubs: "7-iron or driver",
    equipment: "GSPro range view",
    setup: "Picture a 3×3 grid: low/mid/high × left/straight/right. Call the window before each shot.",
    steps: ["Hit 9 shots, one per window, in order (low-left → high-right).", "Score 1 point for a shot that flies in the called window.", "Repeat the grid once; try to beat your first score."],
    successMetric: "6+ of 9 windows hit. Launch Direction matches the call within 5°.",
    cue: "Face sends it, path bends it — set the face first.",
  },
  {
    key: "face_to_path_ladder",
    title: "Face-to-path ladder",
    area: "start_line",
    also: ["spin_control", "driver_accuracy"],
    level: "intermediate",
    minutes: 15,
    clubs: "Driver / 3-wood",
    equipment: "Launch monitor Face Angle + Club Path",
    setup: "Aim straight at the center target. Check Face to Path after each shot.",
    steps: ["Hit 5 shots trying to produce a slight DRAW: face 1–2° closed to path.", "Hit 5 shots trying to produce a slight FADE: face 1–2° open to path.", "Hit 5 straight shots: Face to Path inside ±1.5°.", "Note which shape felt most natural — that's your stock shot."],
    successMetric: "Spin Axis inside ±6° on the straight set; Offline < 15 yd.",
    cue: "Feel the face, don't steer the path.",
  },
  {
    key: "anti_slice_towel",
    title: "Towel under the arm (anti-slice)",
    area: "driver_accuracy",
    also: ["start_line"],
    level: "beginner",
    minutes: 12,
    clubs: "7-iron, then driver",
    equipment: "Towel",
    setup: "Tuck a towel under your trail armpit (right arm for RH). Keep it there through impact.",
    steps: ["10 three-quarter 7-irons keeping the towel pinned.", "10 three-quarter drivers — towel pinned, feel the club approach from the inside.", "10 full drivers without the towel, keeping the same connected feel."],
    successMetric: "Club Path moves toward neutral/in-to-out; Spin Axis drops below +8°.",
    cue: "Arms stay in front of your chest; turn through, don't throw.",
  },
  {
    key: "split_hand_release",
    title: "Split-hand release",
    area: "driver_accuracy",
    also: ["start_line"],
    level: "beginner",
    minutes: 10,
    clubs: "8-iron",
    equipment: "None",
    setup: "Grip with hands 3–4 inches apart (lead hand at top, trail hand lower on the grip).",
    steps: ["Make 10 slow swings feeling the trail hand roll over the lead hand after impact.", "Hit 10 soft 8-irons with the split grip.", "Return to your normal grip and hit 10 more, keeping the release feel."],
    successMetric: "Face Angle at impact closes toward 0° or slightly closed; side spin drops.",
    cue: "Let the toe pass the heel through the ball.",
  },

  // ───────────────────────── Distance & speed ─────────────────────────
  {
    key: "step_change_speed",
    title: "Step-change speed sets",
    area: "distance",
    also: ["consistency"],
    level: "all",
    minutes: 15,
    clubs: "Driver",
    equipment: "Launch monitor Club Speed",
    setup: "Warm up first. Tee high; use your normal ball.",
    steps: ["Set 1: 5 drives at a comfortable 80% — record average club speed.", "Set 2: 5 drives at 95% — swing hard but keep balance in the finish.", "Set 3: 5 drives at 100%+ — reckless speed, don't care where it goes.", "Set 4: 5 drives at 90% — notice the speed carried over."],
    successMetric: "Set 4 club speed is 2+ mph faster than Set 1; Smash Factor stays above 1.42.",
    cue: "Speed first, then aim. Finish in balance every swing.",
  },
  {
    key: "tee_height_launch",
    title: "Launch window with tee height",
    area: "spin_control",
    also: ["distance"],
    level: "all",
    minutes: 12,
    clubs: "Driver",
    equipment: "Tees",
    setup: "Ball positioned off the lead heel. Launch monitor showing Launch Angle, Back Spin, Attack Angle.",
    steps: ["5 drives with the ball teed so half of it sits above the crown.", "5 drives teed slightly higher, ball a half-ball further forward.", "5 drives feeling the club sweep up through the ball (tilt trail shoulder slightly down at address).", "Find the combination that launches 12–15° with 2,000–2,800 rpm."],
    successMetric: "Launch Angle 12–15°, Back Spin 2,000–2,800 rpm, Attack Angle ≥ 0°.",
    cue: "Hit up on it — the tee is there for a reason.",
  },
  {
    key: "smash_center_strike",
    title: "Center-strike smash factor",
    area: "distance",
    also: ["iron_contact", "consistency"],
    level: "all",
    minutes: 12,
    clubs: "Driver or 7-iron",
    equipment: "Foot spray or dry-erase marker (optional)",
    setup: "Mark the face (spray/marker) or just watch Smash Factor and Ball Speed.",
    steps: ["Hit 10 shots at 75% speed focusing only on center contact.", "Hit 10 shots at 90% — same contact goal.", "Compare Smash Factor between sets; speed only counts if the number holds."],
    successMetric: "Driver Smash ≥ 1.45 (irons ≥ 1.33) on 7 of 10 shots.",
    cue: "Center face beats fast face.",
  },

  // ───────────────────────── Iron contact ─────────────────────────
  {
    key: "towel_low_point",
    title: "Towel behind the ball (low point)",
    area: "iron_contact",
    also: ["consistency"],
    level: "all",
    minutes: 12,
    clubs: "9-iron → 7-iron",
    equipment: "Towel",
    setup: "Fold a towel and place it 4–5 inches behind the ball on the mat.",
    steps: ["10 half-swings with a 9-iron, missing the towel and brushing the mat after the ball.", "10 three-quarter 7-irons with the same goal.", "10 full 7-irons; remove the towel for the last 5 and keep the feel."],
    successMetric: "Attack Angle between -2° and -5°; Smash ≥ 1.30; carry spread under 8 yd.",
    cue: "Weight left, hands lead, chest over the ball.",
  },
  {
    key: "feet_together_tempo",
    title: "Feet-together tempo",
    area: "consistency",
    also: ["iron_contact"],
    level: "beginner",
    minutes: 10,
    clubs: "8-iron",
    equipment: "None",
    setup: "Stand with your feet touching, ball in the center.",
    steps: ["Hit 10 smooth 8-irons at 60% — if you lose balance, you swung too hard.", "Widen to a normal stance and hit 10 more at the same tempo.", "Watch Ball Speed: it should barely drop from normal stance at full speed."],
    successMetric: "Smash Factor within 0.03 of your best set; Offline < 12 yd.",
    cue: "Tempo you can balance is tempo you can repeat.",
  },
  {
    key: "trail_foot_back",
    title: "Trail foot back",
    area: "iron_contact",
    also: ["driver_accuracy"],
    level: "intermediate",
    minutes: 10,
    clubs: "7-iron",
    equipment: "None",
    setup: "Drop your trail foot back 12 inches and up onto its toe. Weight ~70% on the lead foot.",
    steps: ["10 three-quarter shots staying on the lead side the whole swing.", "10 normal-stance shots keeping the same forward-pressure feel."],
    successMetric: "Divot (mat brush) after the ball; Attack Angle stays negative; Dynamic Loft drops 2–3°.",
    cue: "Stay on your front side — turn, don't sway.",
  },
  {
    key: "ladder_contact_half_full",
    title: "Half → three-quarter → full ladder",
    area: "iron_contact",
    also: ["distance_control"],
    level: "all",
    minutes: 15,
    clubs: "PW, 8-iron, 6-iron",
    equipment: "Launch monitor Carry",
    setup: "Pick one club. Three swing lengths: hands at hip, hands at shoulder, full.",
    steps: ["3 half swings, 3 three-quarter, 3 full — record carry for each length.", "Repeat with the next club.", "Write down your three numbers per club — these are your in-between yardages."],
    successMetric: "Each swing length produces a carry band no wider than 7 yd.",
    cue: "Same tempo, different length.",
  },

  // ───────────────────────── Distance control ─────────────────────────
  {
    key: "wedge_clock",
    title: "Wedge clock system",
    area: "distance_control",
    also: ["short_game"],
    level: "all",
    minutes: 20,
    clubs: "All wedges",
    equipment: "Launch monitor Carry",
    setup: "Think of your lead arm as a clock hand: 7:30 (short), 9:00 (hip), 10:30 (shoulder).",
    steps: ["Hit 5 shots at each clock position with your sand wedge; log average carry for each.", "Repeat with your gap wedge and pitching wedge.", "Build a 9-number chart (3 wedges × 3 lengths). Save it in Settings notes."],
    successMetric: "Carry at each position repeats within ±5 yd on 4 of 5 shots.",
    cue: "Rhythm stays the same; only the backswing length changes.",
  },
  {
    key: "random_yardage",
    title: "Random yardage game",
    area: "distance_control",
    also: ["course_management"],
    level: "intermediate",
    minutes: 15,
    clubs: "Wedges to 7-iron",
    equipment: "GSPro range targets",
    setup: "In GSPro, pick a target. Before each shot, choose a random number between 60 and 160 yd.",
    steps: ["Hit 12 shots, never the same yardage twice in a row.", "Score: 3 points inside 5 yd of the number, 1 point inside 10 yd.", "Beat 20 points to graduate."],
    successMetric: "Average carry miss under 7 yd across the 12 shots.",
    cue: "Commit to a club and a swing length before you step in.",
  },
  {
    key: "gapping_session",
    title: "Full-bag gapping",
    area: "distance_control",
    also: ["course_management"],
    level: "all",
    minutes: 25,
    clubs: "Every club",
    equipment: "Launch monitor Carry; export the session when done",
    setup: "Start with your lob wedge and work up to driver. Hit 5 good shots per club (throw out obvious mishits).",
    steps: ["Record the median carry of the 5 good shots for each club.", "Look for gaps smaller than 8 yd or larger than 18 yd between adjacent clubs.", "Export the GSPro shot data and import it into the app to update your plan."],
    successMetric: "Even 10–15 yd gaps through the bag; wedge gaps 10–12 yd.",
    cue: "Your stock yardage is the median, not the hero shot.",
  },

  // ───────────────────────── Short game ─────────────────────────
  {
    key: "landing_spot_chips",
    title: "Landing-spot chipping",
    area: "short_game",
    level: "all",
    minutes: 15,
    clubs: "PW, 9-iron, SW",
    equipment: "A towel as a landing spot (or GSPro chipping green)",
    setup: "Put a towel 3 yd onto the 'green'. Same landing spot, different clubs.",
    steps: ["10 chips with a 9-iron landing on the towel — watch how far it rolls.", "10 with a PW, 10 with a SW — same landing spot.", "Note roll-out for each club: that's your chipping ratio."],
    successMetric: "7 of 10 land on or within a club-length of the towel.",
    cue: "Pick the landing spot first, then the club that rolls the rest.",
  },
  {
    key: "hinge_hold_pitch",
    title: "Hinge-and-hold pitching",
    area: "short_game",
    also: ["distance_control"],
    level: "intermediate",
    minutes: 15,
    clubs: "SW / LW",
    equipment: "Launch monitor Carry",
    setup: "Ball center, weight 60% lead side, shaft slightly forward.",
    steps: ["10 pitches to 30 yd — hinge early, hold the angle, rotate through.", "10 pitches to 45 yd, 10 to 60 yd.", "Record carry; the body turn (not the hands) should control distance."],
    successMetric: "Launch Angle stays 28–35°; carry within ±4 yd of target.",
    cue: "Chest controls distance, hands stay quiet.",
  },
  {
    key: "up_and_down_challenge",
    title: "Up-and-down challenge (GSPro)",
    area: "short_game",
    also: ["putting", "course_management"],
    level: "all",
    minutes: 20,
    clubs: "Wedges + putter",
    equipment: "GSPro practice green / short course",
    setup: "Load a par-3 course or use the practice area. Start each hole from 20–40 yd off the green.",
    steps: ["Play 9 'holes': chip/pitch on, then putt out.", "Track how many you get up-and-down in 2.", "Any hole you take 4+ shots, replay it once."],
    successMetric: "4+ of 9 up-and-downs; no three-putts.",
    cue: "Get it on the green and give the putt a chance.",
  },

  // ───────────────────────── Putting ─────────────────────────
  {
    key: "ladder_lag_putting",
    title: "Ladder lag putting",
    area: "putting",
    level: "all",
    minutes: 12,
    clubs: "Putter",
    equipment: "Putting mat or GSPro green; 3 tees",
    setup: "Place tees at 10, 20 and 30 ft (or use GSPro's putting view).",
    steps: ["Putt 3 balls to each distance; goal is finishing within 3 ft past the hole.", "Then alternate 10 → 30 → 20 → 10 ft without looking at the previous result.", "Count balls that finish inside the 3-ft circle."],
    successMetric: "7 of 9 lag putts finish inside 3 ft.",
    cue: "Eyes on the hole for the practice stroke; feel the distance, don't measure it.",
  },
  {
    key: "gate_putting_start_line",
    title: "Gate putting (start line)",
    area: "putting",
    also: ["start_line"],
    level: "all",
    minutes: 10,
    clubs: "Putter",
    equipment: "2 tees",
    setup: "Push two tees into the mat just wider than your putter head, 12 inches in front of the ball on a straight line to the target.",
    steps: ["Roll 15 putts through the gate from 6 ft.", "Any putt that clips a tee, hit 2 more before moving on.", "Finish with 5 putts without the gate."],
    successMetric: "12 of 15 clean through the gate; 6-footers made 8 of 10.",
    cue: "Face square at impact — the gate only cares about the face.",
  },
  {
    key: "around_the_world_putting",
    title: "Around the world (3–6 ft)",
    area: "putting",
    level: "all",
    minutes: 10,
    clubs: "Putter",
    equipment: "Putting mat / GSPro green",
    setup: "Mark 4 spots around the hole at 3 ft, then 4 at 6 ft.",
    steps: ["Make all four 3-footers in a row. Miss one, start over.", "Then all four 6-footers in a row.", "Max 10 minutes — note how many full laps you completed."],
    successMetric: "Complete both laps within 10 minutes.",
    cue: "Same routine, same tempo, every putt.",
  },

  // ───────────────────────── Consistency / transfer ─────────────────────────
  {
    key: "one_ball_round",
    title: "One-ball simulated round",
    area: "course_management",
    also: ["consistency"],
    level: "all",
    minutes: 45,
    clubs: "Full bag",
    equipment: "GSPro — any course",
    setup: "Play 9 holes in GSPro with no mulligans. Full pre-shot routine on every shot.",
    steps: ["Before each shot say the target and the shot shape out loud.", "Aim at the fat side of every green; never short-side yourself.", "After the round, note the 3 shots that cost you the most strokes — those feed your next plan."],
    successMetric: "No penalty strokes; fewer than 2 three-putts; hit your scoring goal for 9.",
    cue: "Practice like you play, so you can play like you practice.",
  },
  {
    key: "two_club_challenge",
    title: "Two-club challenge",
    area: "course_management",
    also: ["distance_control", "short_game"],
    level: "intermediate",
    minutes: 30,
    clubs: "Pick 2 clubs + putter",
    equipment: "GSPro — short course",
    setup: "Play 6 holes with only a 7-iron, a wedge and a putter.",
    steps: ["Plan each hole backwards from the green.", "Use swing-length ladders (half/three-quarter/full) to hit odd yardages.", "Compare your score to your normal full-bag score on the same holes."],
    successMetric: "Within 3 shots of your full-bag score.",
    cue: "Creativity beats brute force.",
  },
  {
    key: "pressure_streak",
    title: "Pressure streak",
    area: "consistency",
    also: ["driver_accuracy"],
    level: "all",
    minutes: 10,
    clubs: "Driver or 7-iron",
    equipment: "GSPro range with fairway/green",
    setup: "Define success: fairway for driver (Offline < 20 yd) or green for 7-iron (Offline < 12 yd, carry ±8 yd).",
    steps: ["Build the longest streak of successful shots you can in 10 minutes.", "A miss resets the streak to zero.", "Log your best streak — try to beat it next session."],
    successMetric: "Streak of 5+ with driver, 6+ with 7-iron.",
    cue: "One shot at a time. The streak is just the scoreboard.",
  },
  {
    key: "warmup_sequence",
    title: "Tee24 warm-up",
    area: "consistency",
    level: "all",
    minutes: 8,
    clubs: "Wedge → 7-iron → driver",
    equipment: "None",
    setup: "Start every session here. Slow swings, building speed.",
    steps: ["10 arm circles + 10 torso rotations with a club across your shoulders.", "6 half-swing wedges at 50%.", "6 three-quarter 7-irons at 70%.", "4 drivers at 80%, then you're ready for the plan."],
    successMetric: "Ball speed within 5 mph of your norm by the last driver.",
    cue: "Warm up to practice; don't practice to warm up.",
  },
  {
    key: "spin_loft_check",
    title: "Spin-loft check (flighted irons)",
    area: "spin_control",
    also: ["iron_contact"],
    level: "advanced",
    minutes: 12,
    clubs: "7-iron",
    equipment: "Launch monitor Dynamic Loft, Attack Angle, Back Spin",
    setup: "Spin loft ≈ Dynamic Loft − Attack Angle. For a 7-iron you want roughly 20–24°.",
    steps: ["Hit 5 stock 7-irons; compute spin loft from the numbers.", "Hit 5 'flighted' shots: ball back a half-ball, hands forward, abbreviated finish.", "Hit 5 high shots: ball forward, full finish. Compare Back Spin and Apex."],
    successMetric: "Stock 7-iron Back Spin 6,000–7,500 rpm; Apex 28–35 yd; Descent Angle 45°+.",
    cue: "Shaft lean controls loft; loft controls spin.",
  },
  {
    key: "driver_spin_window",
    title: "Driver spin window",
    area: "spin_control",
    also: ["distance"],
    level: "intermediate",
    minutes: 12,
    clubs: "Driver",
    equipment: "Launch monitor Back Spin + Launch Angle",
    setup: "Target window: Launch 12–15°, Back Spin 2,000–2,800 rpm.",
    steps: ["Hit 5 drives and note which side of the window you miss (too much spin? too low?).", "Too much spin: tee higher, ball forward, feel level/upward strike.", "Too little spin / too low: ball back a half-ball, slightly more loft on the face.", "Hit 10 more; count shots inside the window."],
    successMetric: "6 of 10 inside the window; carry up 5+ yd versus the first set.",
    cue: "Optimize the window, then add speed.",
  },
];

export const DRILL_BY_KEY: Record<string, Drill> = Object.fromEntries(DRILLS.map((d) => [d.key, d]));
