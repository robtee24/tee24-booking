import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/access";
import { sendPayoutBatch } from "@/services/referral.service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  if (!Array.isArray(body.payoutIds)) {
    return NextResponse.json({ error: "payoutIds[] required" }, { status: 400 });
  }
  try {
    const result = await sendPayoutBatch(body.payoutIds, { actorId: admin.id });
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
