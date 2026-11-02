// GET /api/mobile/league/player?leagueId=&playerId= — scorecards, stats, winnings, teams
import { playerProfile } from "@/services/league.service";
import { fail, ok, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("league/player", async (req, auth) => {
  const leagueId = req.nextUrl.searchParams.get("leagueId")?.trim();
  const playerId = req.nextUrl.searchParams.get("playerId")?.trim();
  if (!leagueId || !playerId) return fail("leagueId and playerId required", 400, "BAD_REQUEST");
  return ok(await playerProfile(leagueId, playerId, auth.memberId));
});
