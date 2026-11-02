// POST /api/pay/card/[token] { sourceId, verificationToken? } → vault a card for the member in the token.
import { NextRequest, NextResponse } from "next/server";
import { verifyCardLinkToken } from "@/lib/card-link";
import { listPaymentMethods, vaultCard } from "@/services/billing.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const memberId = verifyCardLinkToken(token);
  if (!memberId) return NextResponse.json({ error: "This link has expired. Open it again from the Tee24 app." }, { status: 410 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const pm = await vaultCard({ memberId, sourceId: String(body.sourceId ?? ""), verificationToken: typeof body.verificationToken === "string" ? body.verificationToken : null, setDefault: true, source: "portal" });
    const cards = await listPaymentMethods(memberId);
    return NextResponse.json({ ok: true, card: { brand: pm.brand, last4: pm.last4, expMonth: pm.expMonth, expYear: pm.expYear }, count: cards.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save card" }, { status: 400 });
  }
}
