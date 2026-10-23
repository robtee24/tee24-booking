// POST /api/mobile/practice/plan/regenerate → { plan }
import { regeneratePlan } from "@/services/mobile-practice.service";
import { ok, withMobileAuth } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withMobileAuth("practice/plan/regenerate", async (_req, auth) => ok({ plan: await regeneratePlan(auth.memberId, "manual") }));
