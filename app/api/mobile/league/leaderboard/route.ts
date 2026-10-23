// GET /api/mobile/league/leaderboard?leagueId=
import { getLeagueLeaderboard } from "@/services/mobile-events.service";
import { fail, ok, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("league/leaderboard", async (req) => {
  const leagueId = Number(req.nextUrl.searchParams.get("leagueId"));
  if (!Number.isFinite(leagueId)) return fail("leagueId required", 400, "BAD_REQUEST");
  return ok(await getLeagueLeaderboard(leagueId));
});
