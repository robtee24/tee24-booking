// /api/admin/league — League Manager API.
//
//   GET    ?id=                       → full league detail (players, weeks, scores incl. hidden, entries, OCR diagnostics)
//   GET                               → leagues the admin can see
//   POST   { action, ... }            → see ACTIONS below
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { canAccessLocation } from "@/lib/access";
import { getPrisma } from "@/lib/db";
import {
  adminLeagueDetail, adminSetScore, awardChampionship, computeWeek, createLeague, joinLeague, LeagueError, listLeagues,
  markPayoutPaid, regenerateTeams, reviewScore, updateLeague, updatePlayer, updateWeek, waiveEntry,
} from "@/services/league.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Admin = { id: string; role: string; locations: { locationId: string }[] };

function visibleLocationIds(admin: Admin): string[] | null {
  return admin.role === "SCOPED" ? admin.locations.map((l) => l.locationId) : null;
}

async function assertLeague(admin: Admin, leagueId: string) {
  const league = await getPrisma().league.findUnique({ where: { id: leagueId }, select: { locationId: true } });
  if (!league) throw new LeagueError("League not found", 404, "LEAGUE_NOT_FOUND");
  if (!canAccessLocation(admin.role as "ROOT" | "FULL" | "SCOPED", admin.locations.map((l) => l.locationId), league.locationId)) throw new LeagueError("Forbidden", 403, "FORBIDDEN");
}

function fail(err: unknown) {
  if (err instanceof LeagueError) return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status: err.status });
  console.error("[admin/league]", err);
  return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Server error" }, { status: 500 });
}

const date = (v: unknown) => {
  if (v === null || v === "") return null;
  if (v === undefined) return undefined;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new LeagueError("Invalid date");
  return d;
};

export async function GET(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  const admin = guard.admin as unknown as Admin;
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (id) {
      await assertLeague(admin, id);
      return NextResponse.json({ ok: true, ...(await adminLeagueDetail(id)) });
    }
    return NextResponse.json({ ok: true, leagues: await listLeagues(visibleLocationIds(admin)) });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  const admin = guard.admin as unknown as Admin;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed admin action body, validated per action
  const body = (await req.json().catch(() => ({}))) as Record<string, any>;
  const action = String(body.action ?? "");
  try {
    switch (action) {
      case "create": {
        const locationId = String(body.locationId ?? "");
        if (!canAccessLocation(admin.role as "ROOT" | "FULL" | "SCOPED", admin.locations.map((l) => l.locationId), locationId)) throw new LeagueError("Forbidden", 403, "FORBIDDEN");
        const firstWeekStart = date(body.firstWeekStart);
        if (!firstWeekStart) throw new LeagueError("firstWeekStart is required");
        const league = await createLeague(
          {
            locationId,
            name: String(body.name ?? ""),
            description: body.description ?? null,
            firstWeekStart,
            weekCount: Number(body.weekCount ?? 12),
            withChampionshipWeek: !!body.withChampionshipWeek,
            courses: Array.isArray(body.courses) ? body.courses : undefined,
            championshipAt: date(body.championshipAt) ?? null,
            championshipNote: body.championshipNote ?? null,
            weeklyFeeCents: body.weeklyFeeCents != null ? Number(body.weeklyFeeCents) : undefined,
            gimmeDistanceFt: body.gimmeDistanceFt != null ? Number(body.gimmeDistanceFt) : undefined,
            mulligans: body.mulligans != null ? !!body.mulligans : undefined,
            greenSpeed: body.greenSpeed ?? undefined,
            teeRules: body.teeRules,
            rulesUrl: body.rulesUrl ?? null,
          },
          admin.id,
        );
        return NextResponse.json({ ok: true, league });
      }
      case "update": {
        const id = String(body.id ?? "");
        await assertLeague(admin, id);
        const { action: _a, id: _i, ...patch } = body;
        if ("championshipAt" in patch) patch.championshipAt = date(patch.championshipAt) ?? null;
        return NextResponse.json({ ok: true, league: await updateLeague(id, patch, admin.id) });
      }
      case "update-week": {
        const week = await getPrisma().leagueWeek.findUnique({ where: { id: String(body.weekId ?? "") }, select: { leagueId: true } });
        if (!week) throw new LeagueError("Week not found", 404, "WEEK_NOT_FOUND");
        await assertLeague(admin, week.leagueId);
        return NextResponse.json({ ok: true, week: await updateWeek(String(body.weekId), { courseName: body.courseName, opensAt: date(body.opensAt) ?? undefined, deadlineAt: date(body.deadlineAt) ?? undefined, isChampionship: body.isChampionship }, admin.id) });
      }
      case "search-members": {
        const id = String(body.leagueId ?? "");
        await assertLeague(admin, id);
        const league = await getPrisma().league.findUnique({ where: { id }, select: { organizationId: true } });
        const q = String(body.q ?? "").trim();
        if (q.length < 2) return NextResponse.json({ ok: true, members: [] });
        const digits = q.replace(/\D/g, "");
        const members = await getPrisma().member.findMany({
          where: {
            mergedIntoId: null,
            ...(league?.organizationId ? { organizationId: league.organizationId } : {}),
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
            ],
          },
          select: { id: true, firstName: true, lastName: true, phone: true, email: true },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          take: 10,
        });
        return NextResponse.json({ ok: true, members });
      }
      case "add-player": {
        const id = String(body.leagueId ?? "");
        await assertLeague(admin, id);
        const r = await joinLeague({ leagueId: id, memberId: String(body.memberId ?? ""), displayName: body.displayName ?? null, via: "ADMIN", actorId: admin.id });
        return NextResponse.json({ ok: true, ...r });
      }
      case "update-player": {
        const p = await getPrisma().leaguePlayer.findUnique({ where: { id: String(body.playerId ?? "") }, select: { leagueId: true } });
        if (!p) throw new LeagueError("Player not found", 404, "PLAYER_NOT_FOUND");
        await assertLeague(admin, p.leagueId);
        const { action: _a, playerId, ...patch } = body;
        return NextResponse.json({ ok: true, player: await updatePlayer(String(playerId), patch, admin.id) });
      }
      case "set-score": {
        const id = String(body.leagueId ?? "");
        await assertLeague(admin, id);
        const r = await adminSetScore({ leagueId: id, weekId: String(body.weekId ?? ""), playerId: String(body.playerId ?? ""), holes: body.holes, allowLate: body.allowLate !== false, actorId: admin.id });
        return NextResponse.json({ ok: true, score: r.score, entry: r.entry });
      }
      case "review-score": {
        const s = await getPrisma().leagueScore.findUnique({ where: { id: String(body.scoreId ?? "") }, select: { leagueId: true } });
        if (!s) throw new LeagueError("Score not found", 404, "SCORE_NOT_FOUND");
        await assertLeague(admin, s.leagueId);
        return NextResponse.json({ ok: true, score: await reviewScore(String(body.scoreId), { status: body.status === "REJECTED" ? "REJECTED" : "ACCEPTED", rejectReason: body.rejectReason ?? null, holes: body.holes }, admin.id) });
      }
      case "entry-waive": {
        const e = await getPrisma().leagueEntry.findUnique({ where: { id: String(body.entryId ?? "") }, select: { leagueId: true } });
        if (!e) throw new LeagueError("Entry not found", 404, "ENTRY_NOT_FOUND");
        await assertLeague(admin, e.leagueId);
        return NextResponse.json({ ok: true, entry: await waiveEntry(String(body.entryId), admin.id) });
      }
      case "finalize-week": {
        const week = await getPrisma().leagueWeek.findUnique({ where: { id: String(body.weekId ?? "") }, select: { leagueId: true } });
        if (!week) throw new LeagueError("Week not found", 404, "WEEK_NOT_FOUND");
        await assertLeague(admin, week.leagueId);
        return NextResponse.json({ ok: true, ...(await computeWeek(String(body.weekId), { recompute: !!body.recompute, actorId: admin.id })) });
      }
      case "redraw-teams": {
        const week = await getPrisma().leagueWeek.findUnique({ where: { id: String(body.weekId ?? "") }, select: { leagueId: true } });
        if (!week) throw new LeagueError("Week not found", 404, "WEEK_NOT_FOUND");
        await assertLeague(admin, week.leagueId);
        return NextResponse.json({ ...(await regenerateTeams(String(body.weekId), admin.id)) });
      }
      case "payout-paid": {
        const p = await getPrisma().leaguePayout.findUnique({ where: { id: String(body.payoutId ?? "") }, select: { leagueId: true } });
        if (!p) throw new LeagueError("Payout not found", 404, "PAYOUT_NOT_FOUND");
        await assertLeague(admin, p.leagueId);
        return NextResponse.json({ ok: true, payout: await markPayoutPaid(String(body.payoutId), body.paid !== false, admin.id) });
      }
      case "award-championship": {
        const id = String(body.leagueId ?? "");
        await assertLeague(admin, id);
        const awards = Array.isArray(body.awards) ? (body.awards as { playerId: unknown; amountCents: unknown; note?: unknown }[]).map((a) => ({ playerId: String(a.playerId), amountCents: Number(a.amountCents) || 0, note: typeof a.note === "string" ? a.note : null })) : [];
        return NextResponse.json({ ...(await awardChampionship(id, awards, admin.id)) });
      }
      default:
        return NextResponse.json({ ok: false, error: `Unknown action '${action}'` }, { status: 400 });
    }
  } catch (e) {
    return fail(e);
  }
}
