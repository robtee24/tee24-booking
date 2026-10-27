// GET  /api/mobile/membership/change?planId=&guestCount= → { preview, plans }
// POST /api/mobile/membership/change { planId?, guestCount } → { result }
// DELETE /api/mobile/membership/change → cancel a scheduled downgrade
// Same engine as the clubhouse. Never force — MIGRATION_FREEZE still blocks self-service.
import { applyChange, cancelPendingChange, listSelfServicePlans, previewChange } from "@/services/portal-membership.service";
import { fail, ok, readJson, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("membership/change", async (req, auth) => {
  const sp = req.nextUrl.searchParams;
  const planId = sp.get("planId") || null;
  const guestCount = Number(sp.get("guestCount") ?? 0);
  const [{ plans }, preview] = await Promise.all([
    listSelfServicePlans(auth.memberId),
    previewChange(auth.memberId, { planId, guestCount: Number.isFinite(guestCount) ? guestCount : 0 }),
  ]);
  return ok({ preview, plans });
});

export const POST = withMobileAuth("membership/change", async (req, auth) => {
  const body = await readJson<{ planId?: string; guestCount?: number }>(req);
  const guestCount = Number(body.guestCount ?? 0);
  if (!Number.isInteger(guestCount) || guestCount < 0) return fail("guestCount must be a whole number", 400);
  const result = await applyChange(auth.memberId, { planId: body.planId || null, guestCount });
  return ok({ result });
});

export const DELETE = withMobileAuth("membership/change", async (_req, auth) => {
  await cancelPendingChange(auth.memberId);
  return ok({});
});
