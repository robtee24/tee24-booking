// GET  /api/admin/gift-cards?locationSlug=&q=&status=
// POST /api/admin/gift-cards { locationSlug, amountCents, recipientName?, recipientEmail?, purchaserMemberId?, expiresAt?, reason? }  (billing.charge) — manual/comp issue
import { NextResponse, type NextRequest } from "next/server";
import { issueGiftCard, listGiftCards } from "@/services/pos.service";
import { guardPos, posErrorResponse, readJson } from "../sales/_lib";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await guardPos(req);
  if (!g.ok) return g.response;
  const sp = req.nextUrl.searchParams;
  try {
    return NextResponse.json({ giftCards: await listGiftCards(g.location, { q: sp.get("q") ?? undefined, status: sp.get("status") ?? undefined }) });
  } catch (e) {
    return posErrorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  const body = await readJson<{ locationSlug?: string; amountCents?: number; recipientName?: string | null; recipientEmail?: string | null; purchaserMemberId?: string | null; expiresAt?: string | null; reason?: string | null }>(req);
  const g = await guardPos(req, { permission: "billing.charge", body });
  if (!g.ok) return g.response;
  try {
    const giftCard = await issueGiftCard(g.location, { ...body, amountCents: Number(body.amountCents) }, g.admin.id);
    return NextResponse.json({ giftCard }, { status: 201 });
  } catch (e) {
    return posErrorResponse(e);
  }
}
