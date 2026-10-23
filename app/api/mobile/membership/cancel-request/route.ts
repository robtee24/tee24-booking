// POST /api/mobile/membership/cancel-request { reason? }
// Never cancels billing directly: stamps the subscription, opens a staff task
// and raises an admin notification (same path as the web portal).
import { requestCancellation } from "@/services/mobile-member.service";
import { ok, readJson, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withMobileAuth("membership/cancel-request", async (req, auth) => {
  const { reason } = await readJson<{ reason?: string }>(req);
  const result = await requestCancellation(auth.memberId, typeof reason === "string" ? reason : undefined);
  return ok({ ...result });
});
