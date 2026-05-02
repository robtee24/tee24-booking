import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/access";
import { refundCharge } from "@/services/billing.service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  if (!body.chargeId || !body.amountCents) {
    return NextResponse.json({ error: "chargeId and amountCents required" }, { status: 400 });
  }
  try {
    const refund = await refundCharge({
      chargeId: body.chargeId,
      amountCents: Number(body.amountCents),
      reason: body.reason,
      actorId: admin.id,
    });
    return NextResponse.json({ ok: true, refund });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
