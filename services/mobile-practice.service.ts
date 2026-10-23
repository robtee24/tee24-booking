// Game Improvement: survey → plan, GSPro imports → swing analysis → plan re-tune.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseShotCsv, type ParsedShot } from "@/lib/practice/gspro-csv";
import { analyzeShots, mergeFlags, type SwingFlag, type SwingSummary } from "@/lib/practice/swing-analysis";
import { generatePlan, SURVEY_OPTIONS, type SurveyInput } from "@/lib/practice/plan-engine";
import { DRILLS, DRILL_BY_KEY, FOCUS_AREAS } from "@/lib/practice/drills";
import { MobileError } from "@/services/mobile-auth.service";

const MAX_SHOTS_PER_SESSION = 2000;
const MAX_CSV_BYTES = 6 * 1024 * 1024;

type Experience = "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
type Handedness = "RH" | "LH";

const strArr = (v: unknown, allowed?: readonly string[]): string[] => {
  if (!Array.isArray(v)) return [];
  const out = v.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean);
  return allowed ? out.filter((s) => allowed.includes(s)) : out;
};

export type ProfileInput = {
  handicap?: number | null;
  experience?: Experience | null;
  sessionsPerWeek?: number | null;
  minutesPerSession?: number | null;
  handedness?: Handedness | null;
  goals?: unknown;
  issues?: unknown;
  weakClubs?: unknown;
  misses?: unknown;
  survey?: unknown;
};

function cleanProfile(input: ProfileInput) {
  const handicap = input.handicap == null || input.handicap === ("" as unknown) ? null : Number(input.handicap);
  if (handicap != null && (!Number.isFinite(handicap) || handicap < -10 || handicap > 54)) throw new MobileError("Handicap must be between -10 and 54", 400, "BAD_REQUEST");
  const experience = input.experience && ["BEGINNER", "INTERMEDIATE", "ADVANCED"].includes(input.experience) ? input.experience : null;
  const handedness = input.handedness && ["RH", "LH"].includes(input.handedness) ? input.handedness : null;
  const spw = input.sessionsPerWeek == null ? null : Math.min(7, Math.max(1, Math.round(Number(input.sessionsPerWeek))));
  const mps = input.minutesPerSession == null ? null : Math.min(180, Math.max(15, Math.round(Number(input.minutesPerSession))));
  return {
    handicap,
    experience,
    handedness,
    sessionsPerWeek: spw != null && Number.isFinite(spw) ? spw : null,
    minutesPerSession: mps != null && Number.isFinite(mps) ? mps : null,
    goals: strArr(input.goals, SURVEY_OPTIONS.goals.map((o) => o.key)),
    issues: strArr(input.issues, SURVEY_OPTIONS.issues.map((o) => o.key)),
    weakClubs: strArr(input.weakClubs, SURVEY_OPTIONS.weakClubs.map((o) => o.key)),
    misses: strArr(input.misses, SURVEY_OPTIONS.misses.map((o) => o.key)),
    survey: input.survey && typeof input.survey === "object" ? (input.survey as Record<string, unknown>) : null,
  };
}

function toSurvey(p: { handicap: number | null; experience: string | null; sessionsPerWeek: number | null; minutesPerSession: number | null; handedness: string | null; goals: unknown; issues: unknown; weakClubs: unknown; misses: unknown }): SurveyInput {
  return {
    handicap: p.handicap,
    experience: (p.experience as Experience | null) ?? null,
    sessionsPerWeek: p.sessionsPerWeek,
    minutesPerSession: p.minutesPerSession,
    handedness: (p.handedness as Handedness | null) ?? null,
    goals: strArr(p.goals),
    issues: strArr(p.issues),
    weakClubs: strArr(p.weakClubs),
    misses: strArr(p.misses),
  };
}

export function getSurveyOptions() {
  return {
    options: SURVEY_OPTIONS,
    focusAreas: Object.entries(FOCUS_AREAS).map(([key, v]) => ({ key, ...v })),
    experience: [
      { key: "BEGINNER", label: "New to it", blurb: "Under a few years, scores 100+" },
      { key: "INTERMEDIATE", label: "Weekend player", blurb: "Scores in the 85–100 range" },
      { key: "ADVANCED", label: "Serious player", blurb: "Single digits to mid-teens" },
    ],
  };
}

export async function getPracticeProfile(memberId: string) {
  const profile = await prisma.practiceProfile.findUnique({ where: { memberId } });
  return { profile, ...getSurveyOptions() };
}

/** Save survey and (re)generate the plan. */
export async function savePracticeProfile(memberId: string, input: ProfileInput) {
  const data = cleanProfile(input);
  if (!data.goals.length) throw new MobileError("Pick at least one goal", 400, "BAD_REQUEST");
  const { survey, ...rest } = data;
  const surveyJson = (survey ?? undefined) as Prisma.InputJsonValue | undefined;
  const profile = await prisma.practiceProfile.upsert({
    where: { memberId },
    create: { memberId, ...rest, survey: surveyJson },
    update: { ...rest, survey: surveyJson },
  });
  const plan = await regeneratePlan(memberId, "survey");
  return { profile, plan };
}

/** Flags from recent sessions, recency-weighted. */
async function recentFlags(memberId: string) {
  const sessions = await prisma.practiceSession.findMany({
    where: { memberId, shotCount: { gt: 0 } },
    orderBy: { playedAt: "desc" },
    take: 6,
    select: { id: true, playedAt: true, shotCount: true, summary: true },
  });
  const flags = mergeFlags(sessions.map((s) => ({ flags: ((s.summary as { flags?: SwingFlag[] } | null)?.flags ?? []) as SwingFlag[], playedAt: s.playedAt })));
  return { flags, sessionsAnalyzed: sessions.length, shotsAnalyzed: sessions.reduce((a, s) => a + s.shotCount, 0) };
}

export async function regeneratePlan(memberId: string, reason: "survey" | "import" | "manual") {
  const profile = await prisma.practiceProfile.findUnique({ where: { memberId } });
  if (!profile) throw new MobileError("Complete the survey first", 400, "NO_PROFILE");
  const { flags, sessionsAnalyzed, shotsAnalyzed } = await recentFlags(memberId);
  const generated = generatePlan(toSurvey(profile), flags, { sessionsAnalyzed, shotsAnalyzed });

  const current = await prisma.practicePlan.findFirst({ where: { memberId, active: true }, orderBy: { version: "desc" } });
  const plan = await prisma.$transaction(async (tx) => {
    if (current) await tx.practicePlan.update({ where: { id: current.id }, data: { active: false, archivedAt: new Date() } });
    return tx.practicePlan.create({
      data: {
        memberId,
        version: (current?.version ?? 0) + 1,
        title: generated.title,
        summary: generated.summary,
        focusAreas: generated.focusAreas as object[],
        schedule: generated.schedule as object[],
        drills: generated.drills as object[],
        basis: { ...generated.basis, reason } as object,
      },
    });
  });
  return plan;
}

export async function getActivePlan(memberId: string) {
  const [plan, profile] = await Promise.all([
    prisma.practicePlan.findFirst({ where: { memberId, active: true }, orderBy: { version: "desc" } }),
    prisma.practiceProfile.findUnique({ where: { memberId }, select: { id: true } }),
  ]);
  if (!plan) return { plan: null, hasProfile: Boolean(profile), adherence: null };
  const since = new Date(Date.now() - 7 * 86400_000);
  const logs = await prisma.drillLog.findMany({ where: { memberId, completedAt: { gte: since } }, select: { drillKey: true, completedAt: true, minutes: true } });
  const schedule = plan.schedule as { drills: { key: string }[] }[];
  const planned = schedule.reduce((a, s) => a + s.drills.length, 0);
  return {
    plan,
    hasProfile: true,
    adherence: {
      weekDrillsPlanned: planned,
      weekDrillsDone: logs.length,
      weekMinutes: logs.reduce((a, l) => a + (l.minutes ?? 0), 0),
      doneKeys: [...new Set(logs.map((l) => l.drillKey))],
    },
  };
}

export async function listSessions(memberId: string, limit = 30) {
  const sessions = await prisma.practiceSession.findMany({
    where: { memberId },
    orderBy: { playedAt: "desc" },
    take: Math.min(100, Math.max(1, limit)),
    select: { id: true, source: true, playedAt: true, durationMin: true, title: true, notes: true, shotCount: true, fileName: true, summary: true, createdAt: true },
  });
  return {
    sessions: sessions.map((s) => {
      const sum = s.summary as SwingSummary | null;
      return {
        ...s,
        summary: undefined,
        clubs: sum?.clubs?.length ?? 0,
        topFlags: (sum?.flags ?? []).slice(0, 2).map((f) => ({ key: f.key, title: f.title, severity: f.severity })),
        highlights: sum?.highlights ?? [],
        swingAnalysisId: (sum as { swingAnalysisId?: string } | null)?.swingAnalysisId ?? null,
      };
    }),
  };
}

export async function getSession(memberId: string, id: string) {
  const session = await prisma.practiceSession.findFirst({ where: { id, memberId }, include: { shots: { orderBy: { shotAt: "asc" }, take: MAX_SHOTS_PER_SESSION } } });
  if (!session) throw new MobileError("Session not found", 404, "NOT_FOUND");
  return { session };
}

export async function deleteSession(memberId: string, id: string) {
  const s = await prisma.practiceSession.findFirst({ where: { id, memberId }, select: { id: true, shotCount: true } });
  if (!s) throw new MobileError("Session not found", 404, "NOT_FOUND");
  await prisma.practiceSession.delete({ where: { id: s.id } });
  if (s.shotCount > 0 && (await prisma.practiceProfile.count({ where: { memberId } }))) await regeneratePlan(memberId, "import").catch(() => null);
  return { deleted: true };
}

export async function createManualSession(memberId: string, input: { playedAt?: string; durationMin?: number; title?: string; notes?: string; locationId?: string | null }) {
  const playedAt = input.playedAt ? new Date(input.playedAt) : new Date();
  if (Number.isNaN(playedAt.getTime())) throw new MobileError("Invalid date", 400, "BAD_REQUEST");
  const session = await prisma.practiceSession.create({
    data: {
      memberId,
      source: "MANUAL",
      playedAt,
      durationMin: input.durationMin != null ? Math.min(600, Math.max(1, Math.round(input.durationMin))) : null,
      title: input.title?.trim().slice(0, 120) || null,
      notes: input.notes?.trim().slice(0, 2000) || null,
      locationId: input.locationId ?? null,
    },
  });
  return { session };
}

export type ImportInput = { csv?: string; base64?: string; fileName?: string; playedAt?: string; title?: string; notes?: string; durationMin?: number; locationId?: string | null };

/** Import a GSPro (or other launch-monitor) CSV, analyze it, and re-tune the plan. */
export async function importSwingCsv(memberId: string, input: ImportInput) {
  let text = input.csv ?? "";
  if (!text && input.base64) {
    const buf = Buffer.from(input.base64, "base64");
    if (buf.byteLength > MAX_CSV_BYTES) throw new MobileError("File is too large (6 MB max)", 413, "FILE_TOO_LARGE");
    text = buf.toString("utf8");
  }
  if (!text.trim()) throw new MobileError("No CSV data received", 400, "BAD_REQUEST");
  if (Buffer.byteLength(text, "utf8") > MAX_CSV_BYTES) throw new MobileError("File is too large (6 MB max)", 413, "FILE_TOO_LARGE");

  const parsed = parseShotCsv(text);
  if (!parsed.shots.length) {
    throw new MobileError("Couldn't find any shots in that file. Export shot data from GSPro as CSV and try again.", 422, "NO_SHOTS", { columns: parsed.columns.slice(0, 40) });
  }
  const shots: ParsedShot[] = parsed.shots.slice(0, MAX_SHOTS_PER_SESSION);

  const profile = await prisma.practiceProfile.findUnique({ where: { memberId }, select: { handedness: true } });
  const summary = analyzeShots(shots, { handedness: (profile?.handedness as Handedness | null) ?? null });

  const shotTimes = shots.map((s) => s.shotAt?.getTime()).filter((t): t is number => typeof t === "number");
  let playedAt = input.playedAt ? new Date(input.playedAt) : shotTimes.length ? new Date(Math.min(...shotTimes)) : new Date();
  if (Number.isNaN(playedAt.getTime())) playedAt = new Date();
  const durationMin = input.durationMin ?? (shotTimes.length > 1 ? Math.max(5, Math.round((Math.max(...shotTimes) - Math.min(...shotTimes)) / 60000)) : null);

  const clubsLine = summary.clubs
    .slice(0, 3)
    .map((c) => c.club)
    .join(", ");
  const title = input.title?.trim().slice(0, 120) || `GSPro session · ${shots.length} shots${clubsLine ? ` · ${clubsLine}` : ""}`;

  const session = await prisma.$transaction(
    async (tx) => {
      const s = await tx.practiceSession.create({
        data: {
          memberId,
          source: "GSPRO_CSV",
          playedAt,
          durationMin,
          title,
          notes: input.notes?.trim().slice(0, 2000) || null,
          shotCount: shots.length,
          fileName: input.fileName?.slice(0, 200) ?? null,
          locationId: input.locationId ?? null,
          summary: { ...summary, unitNotes: parsed.unitNotes, unmatchedColumns: parsed.unmatched.slice(0, 30) } as object,
        },
      });
      await tx.swingShot.createMany({
        data: shots.map((sh) => ({
          sessionId: s.id,
          club: sh.club,
          ballSpeed: sh.ballSpeed,
          clubSpeed: sh.clubSpeed,
          smashFactor: sh.smashFactor,
          launchAngle: sh.launchAngle,
          launchDir: sh.launchDir,
          backSpin: sh.backSpin,
          sideSpin: sh.sideSpin,
          spinAxis: sh.spinAxis,
          carry: sh.carry,
          total: sh.total,
          offline: sh.offline,
          apex: sh.apex,
          descentAngle: sh.descentAngle,
          clubPath: sh.clubPath,
          faceAngle: sh.faceAngle,
          faceToPath: sh.faceToPath,
          attackAngle: sh.attackAngle,
          dynamicLoft: sh.dynamicLoft,
          shotAt: sh.shotAt,
          raw: sh.raw as object,
        })),
      });
      return s;
    },
    { timeout: 30_000 },
  );

  // Re-tune the plan if the member has a profile. Plan changes are surfaced to the app.
  let plan = null;
  let planChanged = false;
  const hasProfile = await prisma.practiceProfile.count({ where: { memberId } });
  if (hasProfile) {
    const prev = await prisma.practicePlan.findFirst({ where: { memberId, active: true }, select: { focusAreas: true } });
    plan = await regeneratePlan(memberId, "import");
    const prevKeys = ((prev?.focusAreas as { key: string }[] | undefined) ?? []).map((f) => f.key).join("|");
    const nextKeys = (plan.focusAreas as { key: string }[]).map((f) => f.key).join("|");
    planChanged = prevKeys !== nextKeys;
  }

  return {
    session: { id: session.id, playedAt: session.playedAt, title: session.title, shotCount: session.shotCount, durationMin: session.durationMin },
    summary,
    unitNotes: parsed.unitNotes,
    unmatchedColumns: parsed.unmatched,
    plan,
    planChanged,
  };
}

export async function logDrill(memberId: string, input: { drillKey?: string; planId?: string | null; minutes?: number; rating?: number; notes?: string }) {
  if (!input.drillKey || !DRILL_BY_KEY[input.drillKey]) throw new MobileError("Unknown drill", 400, "BAD_REQUEST");
  let planId: string | null = null;
  if (input.planId) {
    const p = await prisma.practicePlan.findFirst({ where: { id: input.planId, memberId }, select: { id: true } });
    planId = p?.id ?? null;
  }
  const log = await prisma.drillLog.create({
    data: {
      memberId,
      planId,
      drillKey: input.drillKey,
      minutes: input.minutes != null ? Math.min(300, Math.max(1, Math.round(input.minutes))) : null,
      rating: input.rating != null ? Math.min(5, Math.max(1, Math.round(input.rating))) : null,
      notes: input.notes?.trim().slice(0, 1000) || null,
    },
  });
  return { log };
}

/** Trend data for the Progress screen: per-club carry/smash/dispersion over time + flag history. */
export async function getProgress(memberId: string) {
  const sessions = await prisma.practiceSession.findMany({
    where: { memberId, shotCount: { gt: 0 } },
    orderBy: { playedAt: "asc" },
    take: 40,
    select: { id: true, playedAt: true, shotCount: true, summary: true, title: true },
  });
  const logs = await prisma.drillLog.findMany({ where: { memberId, completedAt: { gte: new Date(Date.now() - 56 * 86400_000) } }, select: { completedAt: true, minutes: true, drillKey: true } });

  type Point = { sessionId: string; playedAt: Date; carry: number | null; carrySd: number | null; smash: number | null; offlineSd: number | null; ballSpeed: number | null; clubSpeed: number | null; backSpin: number | null; n: number };
  const byClub = new Map<string, Point[]>();
  const flagHistory: { playedAt: Date; flags: { key: string; title: string; severity: number; area: string }[] }[] = [];
  for (const s of sessions) {
    const sum = s.summary as SwingSummary | null;
    if (!sum) continue;
    for (const c of sum.clubs ?? []) {
      if (c.n < 3) continue;
      const arr = byClub.get(c.club) ?? [];
      arr.push({ sessionId: s.id, playedAt: s.playedAt, carry: c.carry?.mean ?? null, carrySd: c.carry?.sd ?? null, smash: c.smash, offlineSd: c.offlineSd, ballSpeed: c.ballSpeed, clubSpeed: c.clubSpeed, backSpin: c.backSpin, n: c.n });
      byClub.set(c.club, arr);
    }
    flagHistory.push({ playedAt: s.playedAt, flags: (sum.flags ?? []).slice(0, 6).map((f) => ({ key: f.key, title: f.title, severity: f.severity, area: f.area })) });
  }

  // Deltas: first vs last session for clubs with 2+ points
  const clubs = [...byClub.entries()].map(([club, points]) => {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    const d = (a: number | null, b: number | null) => (a == null || b == null ? null : Math.round((b - a) * 10) / 10);
    return {
      club,
      points,
      delta: points.length >= 2 ? { carry: d(first.carry, last.carry), smash: d(first.smash, last.smash), offlineSd: d(first.offlineSd, last.offlineSd), carrySd: d(first.carrySd, last.carrySd), ballSpeed: d(first.ballSpeed, last.ballSpeed) } : null,
    };
  });

  // Weekly practice minutes (last 8 weeks)
  const weeks: { weekStart: string; minutes: number; drills: number }[] = [];
  const now = new Date();
  for (let i = 7; i >= 0; i--) {
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay() - i * 7);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    const inWeek = logs.filter((l) => l.completedAt >= start && l.completedAt < end);
    weeks.push({ weekStart: start.toISOString(), minutes: inWeek.reduce((a, l) => a + (l.minutes ?? 0), 0), drills: inWeek.length });
  }

  const { flags } = await recentFlags(memberId);
  return {
    sessions: sessions.map((s) => ({ id: s.id, playedAt: s.playedAt, shotCount: s.shotCount, title: s.title })),
    clubs,
    flagHistory,
    currentFlags: flags.slice(0, 6),
    weeks,
    totals: { sessions: sessions.length, shots: sessions.reduce((a, s) => a + s.shotCount, 0), drillsLogged: logs.length, minutesLogged: logs.reduce((a, l) => a + (l.minutes ?? 0), 0) },
  };
}

export function listDrills() {
  return { drills: DRILLS, focusAreas: Object.entries(FOCUS_AREAS).map(([key, v]) => ({ key, ...v })) };
}
