// Family add-on from the Tee24 app.
//   GET    /api/mobile/membership/family                 → { family } (plan allowance, price, members, required fields/waivers)
//   POST   /api/mobile/membership/family { ...member }   → add a family member (prorated charge to the holder's card, or pay link)
//   DELETE /api/mobile/membership/family { subscriptionId } → end a family member's membership at period end
// See services/family-addon.service.ts.
import { addFamilyMemberToAccount, getFamilyContext, removeFamilyMemberFromAccount, serializeFamily } from "@/services/family-addon.service";
import { clientIp, fail, ok, readJson, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("membership/family", async (_req, auth) => {
  const ctx = await getFamilyContext(auth.memberId);
  return ok({ family: serializeFamily(ctx) });
});

export const POST = withMobileAuth("membership/family", async (req, auth) => {
  const body = await readJson(req);
  const result = await addFamilyMemberToAccount(auth.memberId, body, { ip: clientIp(req), userAgent: req.headers.get("user-agent") });
  const ctx = await getFamilyContext(auth.memberId);
  return ok({ result, family: serializeFamily(ctx) });
});

export const DELETE = withMobileAuth("membership/family", async (req, auth) => {
  const body = await readJson<{ subscriptionId?: string }>(req);
  if (!body.subscriptionId) return fail("subscriptionId is required", 400);
  const result = await removeFamilyMemberFromAccount(auth.memberId, body.subscriptionId);
  const ctx = await getFamilyContext(auth.memberId);
  return ok({ result, family: serializeFamily(ctx) });
});
