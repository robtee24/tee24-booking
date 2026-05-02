import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/access";
import { freezeSubscription, unfreezeSubscription } from "@/services/membership.service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  try {
    const result = await freezeSubscription(
      {
        subscriptionId: id,
        immediate: !!body.immediate,
        startDate: body.startDate ? new Date(body.startDate) : undefined,
        resumeDate: new Date(body.resumeDate),
        feeCents: body.feeCents,
        reason: body.reason ?? "",
      },
      admin.id
    );
    return NextResponse.json({ ok: true, subscription: result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const result = await unfreezeSubscription(id, admin.id);
    return NextResponse.json({ ok: true, subscription: result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
