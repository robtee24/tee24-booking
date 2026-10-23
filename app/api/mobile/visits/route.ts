// GET /api/mobile/visits — recent check-ins + current allowance
import { listRecentVisits } from "@/services/mobile-member.service";
import { getVisitAllowance } from "@/services/visit-allowance.service";
import { ok, withMobileAuth } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("visits", async (_req, auth) => {
  const [visits, allowance] = await Promise.all([listRecentVisits(auth.memberId), getVisitAllowance(auth.memberId)]);
  return ok({ visits, allowance });
});
