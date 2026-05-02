import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/access";
import { extendSubscription } from "@/services/membership.service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json();
  try {
    const result = await extendSubscription(id, Number(body.days), admin.id, {
      chargeCents: body.chargeCents,
      reason: body.reason,
    });
    return NextResponse.json({ ok: true, subscription: result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
