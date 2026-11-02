// GET /api/mobile/league/overview — my leagues: standing, handicap, current week, entries
import { memberLeagueOverview } from "@/services/league.service";
import { ok, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("league/overview", async (_req, auth) => ok(await memberLeagueOverview(auth.memberId)));
