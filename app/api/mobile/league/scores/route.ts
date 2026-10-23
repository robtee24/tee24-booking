// POST /api/mobile/league/scores { leagueId, weekId, holes: number[18], scorecardImage?, playerId? }
import { submitLeagueScore } from "@/services/mobile-events.service";
import { fail, ok, readJson, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withMobileAuth("league/scores", async (req, auth) => {
  const body = await readJson<Record<string, unknown>>(req);
  const leagueId = Number(body.leagueId);
  const weekId = Number(body.weekId);
  if (!Number.isFinite(leagueId) || !Number.isFinite(weekId)) return fail("leagueId and weekId required", 400, "BAD_REQUEST");
  const result = await submitLeagueScore(auth.memberId, {
    leagueId,
    weekId,
    holes: Array.isArray(body.holes) ? (body.holes as number[]) : [],
    scorecardImage: typeof body.scorecardImage === "string" ? body.scorecardImage : null,
    playerId: body.playerId != null ? Number(body.playerId) : null,
  });
  return ok(result);
});
