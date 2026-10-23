// POST /api/portal/practice/plan/regenerate
import { regeneratePlan } from "@/services/mobile-practice.service";
import { ok, withPortalMember } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withPortalMember("practice/plan/regenerate", async (_req, auth) => ok({ plan: await regeneratePlan(auth.memberId, "manual") }), { write: true });
