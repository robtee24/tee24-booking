// GET /api/portal/practice/plan — active practice plan + this week's adherence
import { getActivePlan } from "@/services/mobile-practice.service";
import { ok, withPortalMember } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withPortalMember("practice/plan", async (_req, auth) => ok(await getActivePlan(auth.memberId)));
