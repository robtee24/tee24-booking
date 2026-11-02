// POST /api/mobile/league/join { leagueId, displayName? } — join (or re-activate) in a league
import { joinLeague } from "@/services/league.service";
import { fail, ok, readJson, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withMobileAuth("league/join", async (req, auth) => {
  const body = await readJson<{ leagueId?: string; displayName?: string | null }>(req);
  const leagueId = String(body.leagueId ?? "").trim();
  if (!leagueId) return fail("leagueId required", 400, "BAD_REQUEST");
  const { player, created } = await joinLeague({ leagueId, memberId: auth.memberId, displayName: body.displayName ?? null, via: "APP" });
  return ok({ player: { id: player.id, displayName: player.displayName, isMinor: player.isMinor, winningsEligible: player.winningsEligible }, created });
});
