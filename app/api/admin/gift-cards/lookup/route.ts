// GET /api/admin/gift-cards/lookup?locationSlug=&code=  — balance check by full code (used for redemption)
import { NextResponse, type NextRequest } from "next/server";
import { lookupGiftCard } from "@/services/pos.service";
import { guardPos, posErrorResponse } from "../../sales/_lib";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await guardPos(req);
  if (!g.ok) return g.response;
  try {
    const code = req.nextUrl.searchParams.get("code") ?? "";
    if (code.replace(/[^A-Za-z0-9]/g, "").length < 16) return NextResponse.json({ error: "Enter the full 16-character code" }, { status: 400 });
    return NextResponse.json({ giftCard: await lookupGiftCard(g.location, code) });
  } catch (e) {
    return posErrorResponse(e);
  }
}
