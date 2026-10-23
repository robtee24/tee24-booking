// GET /api/mobile/practice/plan → { plan, hasProfile, adherence }
import { getActivePlan } from "@/services/mobile-practice.service";
import { ok, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("practice/plan", async (_req, auth) => ok(await getActivePlan(auth.memberId)));
