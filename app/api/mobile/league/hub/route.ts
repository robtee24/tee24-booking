// GET /api/mobile/league/hub?leagueId= — points standings, weeks (teams, results, pots), settings
import { leagueHub } from "@/services/league.service";
import { fail, ok, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("league/hub", async (req, auth) => {
  const leagueId = req.nextUrl.searchParams.get("leagueId")?.trim();
  if (!leagueId) return fail("leagueId required", 400, "BAD_REQUEST");
  return ok(await leagueHub(leagueId, auth.memberId));
});
