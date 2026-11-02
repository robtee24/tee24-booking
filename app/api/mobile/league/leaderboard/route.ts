// GET /api/mobile/league/leaderboard?leagueId= — points standings only
import { leagueStandings } from "@/services/league.service";
import { fail, ok, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("league/leaderboard", async (req) => {
  const leagueId = req.nextUrl.searchParams.get("leagueId")?.trim();
  if (!leagueId) return fail("leagueId required", 400, "BAD_REQUEST");
  return ok({ leagueId, standings: await leagueStandings(leagueId) });
});
