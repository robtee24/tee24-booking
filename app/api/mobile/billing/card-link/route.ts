// GET /api/mobile/billing/card-link → { url, expiresAt, hasCard, card }
//
// The app opens `url` in the system browser so the member can add a card on
// file (hosted Square form). Used by the league join / submit flows.
import { getPrisma } from "@/lib/db";
import { cardLinkUrl, mintCardLinkToken } from "@/lib/card-link";
import { ok, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("billing/card-link", async (_req, auth) => {
  const card = await getPrisma().paymentMethod.findFirst({
    where: { memberId: auth.memberId, status: { not: "EXPIRED" }, squareCardId: { not: null } },
    select: { last4: true, brand: true, expMonth: true, expYear: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
  const { token, expiresAt } = mintCardLinkToken(auth.memberId);
  return ok({ url: cardLinkUrl(token), expiresAt: expiresAt.toISOString(), hasCard: !!card, card });
});
