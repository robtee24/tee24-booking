// GET /api/league/public — read-only league data for the public league site
// (league.tee24.golf). No auth; returns only what the public /league pages
// already render (names, scores after reveal, points, payouts). Member ids
// are stripped.
//
//   ?view=leagues               → every OPEN / ACTIVE / COMPLETE league (summary)
//   ?view=current               → hub for the running league (or the latest finished one)
//   ?view=hub&id=…              → hub for one league
//   ?view=player&id=…&pid=…     → player profile
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { currentWeekOf, leagueHub, LeagueError, playerProfile } from "@/services/league.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" };

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: CACHE });
}

function fail(e: unknown) {
  if (e instanceof LeagueError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  console.error("[league/public]", e);
  return NextResponse.json({ error: "Server error" }, { status: 500 });
}

type Hub = Awaited<ReturnType<typeof leagueHub>>;
type Profile = Awaited<ReturnType<typeof playerProfile>>;

function scrubHub(hub: Hub) {
  const { myPlayerId: _m, ...rest } = hub;
  return { ...rest, standings: rest.standings.map(({ memberId: _id, ...s }) => s) };
}

function scrubProfile(p: Profile) {
  const { memberId: _id, isSelf: _s, ...player } = p.player;
  return { ...p, player, standing: p.standing ? (({ memberId: _m, ...s }) => s)(p.standing) : null };
}

async function runningLeagueId() {
  const prisma = getPrisma();
  const live = await prisma.league.findFirst({ where: { status: { in: ["OPEN", "ACTIVE"] } }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (live) return live.id;
  const done = await prisma.league.findFirst({ where: { status: "COMPLETE" }, orderBy: { createdAt: "desc" }, select: { id: true } });
  return done?.id ?? null;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const view = sp.get("view") ?? "current";
  try {
    if (view === "leagues") {
      const now = new Date();
      const leagues = await getPrisma().league.findMany({
        where: { status: { in: ["OPEN", "ACTIVE", "COMPLETE"] } },
        include: { weeks: { orderBy: { weekNumber: "asc" } }, _count: { select: { players: { where: { active: true } } } } },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      });
      return json({
        leagues: leagues.map((l) => {
          const w = currentWeekOf(l.weeks, now);
          return {
            id: l.id,
            name: l.name,
            status: l.status,
            playerCount: l._count.players,
            championshipPotCents: l.championshipPotCents,
            championshipAt: l.championshipAt?.toISOString() ?? null,
            currentWeek: w ? { id: w.id, weekNumber: w.weekNumber, courseName: w.courseName, potCents: w.potCents, deadlineAt: w.deadlineAt.toISOString() } : null,
          };
        }),
      });
    }
    if (view === "current") {
      const id = await runningLeagueId();
      if (!id) return json({ hub: null });
      return json({ hub: scrubHub(await leagueHub(id)) });
    }
    if (view === "hub") {
      const id = sp.get("id") ?? "";
      if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
      return json({ hub: scrubHub(await leagueHub(id)) });
    }
    if (view === "player") {
      const id = sp.get("id") ?? "";
      const pid = sp.get("pid") ?? "";
      if (!id || !pid) return NextResponse.json({ error: "id and pid required" }, { status: 400 });
      return json({ profile: scrubProfile(await playerProfile(id, pid)) });
    }
    return NextResponse.json({ error: "Unknown view" }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
