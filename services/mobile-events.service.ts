/**
 * Events feed + RSVP for the member app, and the league bridge (standings,
 * my scores, score submission) built on lib/league-api.
 */
import { getPrisma } from "@/lib/db";
import { leagueApi, leagueConfigured, matchPlayer, type LeagueScore, type LeagueWeek } from "@/lib/league-api";
import { MobileError } from "@/services/mobile-auth.service";

/* ────────────────────────────── Events ────────────────────────────────── */

export async function listEventsForMember(memberId: string, opts: { locationId?: string | null; includePast?: boolean } = {}) {
  const prisma = getPrisma();
  const member = await prisma.member.findUnique({ where: { id: memberId }, select: { locationId: true, homeLocationId: true } });
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000); // still show events that started <6h ago
  const events = await prisma.event.findMany({
    where: {
      published: true,
      ...(opts.includePast ? {} : { OR: [{ endsAt: { gte: since } }, { endsAt: null, startsAt: { gte: since } }, { kind: "LEAGUE", startsAt: { gte: new Date(Date.now() - 120 * 86_400_000) } }] }),
      ...(opts.locationId ? { OR: [{ locationId: opts.locationId }, { locationId: null }] } : {}),
    },
    include: {
      location: { select: { id: true, slug: true, name: true, timezone: true } },
      rsvps: { where: { memberId }, select: { status: true } },
      _count: { select: { rsvps: { where: { status: "GOING" } } } },
    },
    orderBy: [{ featured: "desc" }, { startsAt: "asc" }],
    take: 60,
  });
  const homeId = member?.homeLocationId ?? member?.locationId ?? null;
  return events.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    kind: e.kind,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt?.toISOString() ?? null,
    scheduleNote: e.scheduleNote,
    imageUrl: e.imageUrl,
    ctaLabel: e.ctaLabel,
    ctaUrl: e.ctaUrl,
    leagueId: e.leagueId,
    capacity: e.capacity,
    featured: e.featured,
    location: e.location,
    isHome: e.location ? e.location.id === homeId : true,
    goingCount: e._count.rsvps,
    myRsvp: e.rsvps[0]?.status ?? null,
  }));
}

export async function setRsvp(memberId: string, eventId: string, status: "GOING" | "INTERESTED" | "DECLINED" | null) {
  const prisma = getPrisma();
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, capacity: true, _count: { select: { rsvps: { where: { status: "GOING" } } } } } });
  if (!event) throw new MobileError("Event not found", 404, "NOT_FOUND");
  if (status === null) {
    await prisma.eventRsvp.deleteMany({ where: { eventId, memberId } });
    return { myRsvp: null };
  }
  if (status === "GOING" && event.capacity != null) {
    const mine = await prisma.eventRsvp.findUnique({ where: { eventId_memberId: { eventId, memberId } } });
    if (mine?.status !== "GOING" && event._count.rsvps >= event.capacity) throw new MobileError("This event is full.", 409, "EVENT_FULL");
  }
  await prisma.eventRsvp.upsert({ where: { eventId_memberId: { eventId, memberId } }, update: { status }, create: { eventId, memberId, status } });
  return { myRsvp: status };
}

/* ────────────────────────────── League ────────────────────────────────── */

const SEASON_WEEKS = 12;

type Standing = { playerId: number; name: string; weighted: number; gross: number; rounds: number; rank: number };

function displayWeek(w: LeagueWeek) {
  return w.isChampionship ? SEASON_WEEKS : w.weekNumber;
}

function latestPerPlayerWeek(scores: LeagueScore[]) {
  const map = new Map<string, LeagueScore>();
  for (const s of scores) {
    const key = `${s.playerId}:${displayWeek(s.week)}`;
    const prev = map.get(key);
    if (!prev || prev.id < s.id) map.set(key, s);
  }
  return [...map.values()];
}

function standings(scores: LeagueScore[], players: { id: number; firstName: string; lastName: string | null }[]): Standing[] {
  const latest = latestPerPlayerWeek(scores);
  const rows = players.map((p) => {
    const mine = latest.filter((s) => s.playerId === p.id);
    const weighted = mine.reduce((sum, s) => sum + (s.weightedScore ?? s.total ?? 0), 0);
    const gross = mine.reduce((sum, s) => sum + (s.total ?? 0), 0);
    return { playerId: p.id, name: `${p.firstName} ${p.lastName ?? ""}`.trim(), weighted: Math.round(weighted * 10) / 10, gross, rounds: mine.length, rank: 0 };
  });
  rows.sort((a, b) => (b.rounds === 0) === (a.rounds === 0) ? a.weighted - b.weighted : a.rounds === 0 ? 1 : -1);
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

export async function getLeagueOverview(memberId: string) {
  if (!leagueConfigured()) return { configured: false, leagues: [] as unknown[] };
  const prisma = getPrisma();
  const member = await prisma.member.findUnique({ where: { id: memberId }, select: { firstName: true, lastName: true, phone: true, email: true, location: { select: { name: true } } } });
  if (!member) throw new MobileError("Member not found", 404, "MEMBER_NOT_FOUND");

  const leagues = await leagueApi.leagues();
  const out = [];
  for (const league of leagues) {
    const [players, weeks, courses, scores, handicaps] = await Promise.all([
      leagueApi.players(league.id),
      leagueApi.weeks(league.id),
      leagueApi.courses(league.id).catch(() => []),
      leagueApi.scores({ leagueId: league.id }),
      leagueApi.handicaps({ leagueId: league.id }).catch(() => []),
    ]);
    const me = matchPlayer(players, member);
    const table = standings(scores, players);
    const myRow = me ? table.find((r) => r.playerId === me.id) ?? null : null;
    const myScores = me ? latestPerPlayerWeek(scores.filter((s) => s.playerId === me.id)).sort((a, b) => displayWeek(a.week) - displayWeek(b.week)) : [];
    const myHandicaps = me ? handicaps.filter((h) => h.playerId === me.id).sort((a, b) => displayWeek(b.week) - displayWeek(a.week)) : [];
    const sortedWeeks = [...weeks].sort((a, b) => displayWeek(a) - displayWeek(b));
    const submittedWeekIds = new Set(myScores.map((s) => s.weekId));
    out.push({
      id: league.id,
      name: league.name,
      isHome: member.location.name.toLowerCase().includes(league.name.toLowerCase()),
      playerCount: players.length,
      me: me ? { id: me.id, name: `${me.firstName} ${me.lastName ?? ""}`.trim() } : null,
      standing: myRow,
      leaders: table.slice(0, 5),
      currentHandicap: myHandicaps[0]?.appliedHandicap ?? myHandicaps[0]?.handicap ?? null,
      weeks: sortedWeeks.map((w) => ({
        id: w.id,
        weekNumber: displayWeek(w),
        isChampionship: w.isChampionship,
        course: courses.find((c) => c.week === w.weekNumber)?.name ?? null,
        submitted: submittedWeekIds.has(w.id),
      })),
      myScores: myScores.map((s) => ({
        id: s.id,
        weekId: s.weekId,
        weekNumber: displayWeek(s.week),
        holes: Array.from({ length: 18 }, (_, i) => (s as Record<string, unknown>)[`hole${i + 1}`] as number | null),
        front9: s.front9,
        back9: s.back9,
        total: s.total,
        weightedScore: s.weightedScore,
        scorecardImage: s.scorecardImage,
        createdAt: s.createdAt,
      })),
    });
  }
  return { configured: true, leagues: out };
}

export async function getLeagueLeaderboard(leagueId: number) {
  if (!leagueConfigured()) throw new MobileError("League is not configured", 503, "LEAGUE_UNAVAILABLE");
  const [players, scores] = await Promise.all([leagueApi.players(leagueId), leagueApi.scores({ leagueId })]);
  return { leagueId, standings: standings(scores, players) };
}

export async function submitLeagueScore(memberId: string, input: { leagueId: number; weekId: number; holes: number[]; scorecardImage?: string | null; playerId?: number | null }) {
  if (!leagueConfigured()) throw new MobileError("League is not configured", 503, "LEAGUE_UNAVAILABLE");
  if (!Array.isArray(input.holes) || input.holes.length !== 18) throw new MobileError("Enter all 18 holes", 400, "BAD_REQUEST");
  const holes = input.holes.map((h) => Math.round(Number(h)));
  if (holes.some((h) => !Number.isFinite(h) || h < 1 || h > 15)) throw new MobileError("Each hole must be between 1 and 15 strokes", 400, "BAD_REQUEST");

  const member = await getPrisma().member.findUnique({ where: { id: memberId }, select: { firstName: true, lastName: true, phone: true, email: true } });
  if (!member) throw new MobileError("Member not found", 404, "MEMBER_NOT_FOUND");
  const players = await leagueApi.players(input.leagueId);
  // Members may only submit for themselves (or a playing partner they explicitly pick).
  const me = matchPlayer(players, member);
  const target = input.playerId ? players.find((p) => p.id === input.playerId) ?? null : me;
  if (!target) throw new MobileError("We couldn't find you on the league roster. Ask staff to add your phone number to your league profile.", 404, "NOT_ON_ROSTER");
  const weeks = await leagueApi.weeks(input.leagueId);
  const week = weeks.find((w) => w.id === input.weekId);
  if (!week) throw new MobileError("Week not found", 404, "NOT_FOUND");

  const existing = await leagueApi.scores({ playerId: target.id, weekId: week.id });
  if (existing.some((s) => !s.isDefault && s.total != null)) {
    throw new MobileError(`A score for week ${displayWeek(week)} has already been submitted for ${target.firstName}. Contact the league manager to change it.`, 409, "ALREADY_SUBMITTED");
  }
  const score = await leagueApi.submitScore({ playerId: target.id, weekId: week.id, scores: holes, scorecardImage: input.scorecardImage ?? null });
  return { score: { id: score.id, total: score.total, front9: score.front9, back9: score.back9, weightedScore: score.weightedScore }, player: { id: target.id, name: `${target.firstName} ${target.lastName ?? ""}`.trim() }, weekNumber: displayWeek(week) };
}

export async function uploadScorecardPhoto(base64: string, mime: string) {
  if (!leagueConfigured()) throw new MobileError("League is not configured", 503, "LEAGUE_UNAVAILABLE");
  const clean = base64.replace(/^data:[^;]+;base64,/, "");
  const bytes = Buffer.from(clean, "base64");
  if (!bytes.length) throw new MobileError("Empty image", 400, "BAD_REQUEST");
  if (bytes.length > 8 * 1024 * 1024) throw new MobileError("Image too large (8 MB max)", 413, "TOO_LARGE");
  const ext = mime.includes("png") ? "png" : mime.includes("heic") ? "heic" : "jpg";
  const url = await leagueApi.uploadScorecard(new Uint8Array(bytes), mime || "image/jpeg", `scorecard-${Date.now()}.${ext}`);
  return { url };
}
