// GET /api/mobile/practice/club-map → average carry per club from GSPro exports
import { getClubMap } from "@/services/mobile-practice.service";
import { ok, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("practice/club-map", async (_req, auth) => ok(await getClubMap(auth.memberId)));
