import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/access";
import { runCharge } from "@/services/billing.service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  if (!body.invoiceId || !body.paymentMethodId) {
    return NextResponse.json({ error: "invoiceId and paymentMethodId required" }, { status: 400 });
  }
  try {
    const charge = await runCharge({
      invoiceId: body.invoiceId,
      paymentMethodId: body.paymentMethodId,
      amountCents: body.amountCents,
      note: body.note,
      actorId: admin.id,
    });
    return NextResponse.json({ ok: true, charge });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
