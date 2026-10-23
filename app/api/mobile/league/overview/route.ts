// GET /api/mobile/league/overview — my leagues, standing, handicap, weeks, scores
import { getLeagueOverview } from "@/services/mobile-events.service";
import { ok, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("league/overview", async (_req, auth) => ok(await getLeagueOverview(auth.memberId)));
