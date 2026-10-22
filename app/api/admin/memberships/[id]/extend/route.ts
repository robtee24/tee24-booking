import { NextRequest, NextResponse } from "next/server";
import { assertCan } from "@/lib/permissions";
import { emitMemberEvent } from "@/lib/events";
import { extendSubscription } from "@/services/membership.service";
import { createInvoice } from "@/services/billing.service";
import { apiError, readJson, toCents } from "@/app/api/admin/members/_shared";
import { requireSubscriptionApi } from "../_guard";

export const dynamic = "force-dynamic";

/** POST /api/admin/memberships/[id]/extend { days, chargeCents? | charge?, reason? } — permission membership.subscribe */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireSubscriptionApi(id);
  if (!g.ok) return g.response;
  const body = await readJson(req);
  try {
    assertCan(g.actor, "membership.subscribe", { locationId: g.sub.locationId });
    const days = Math.round(Number(body.days));
    if (!Number.isFinite(days) || days === 0) return NextResponse.json({ error: "days must be a non-zero number" }, { status: 400 });
    const chargeCents = body.chargeCents != null ? Math.round(Number(body.chargeCents)) : toCents(body.charge);
    const result = await extendSubscription(id, days, g.admin.id, { chargeCents: chargeCents || undefined, reason: body.reason });

    let invoice: { id: string; number: number } | null = null;
    if (chargeCents > 0) {
      const inv = await createInvoice(
        {
          organizationId: g.sub.organizationId,
          locationId: g.sub.locationId,
          memberId: g.sub.memberId,
          subscriptionId: id,
          description: `Extension (${days} days) — ${g.sub.planName}`,
          dueDate: new Date(),
          lines: [{ description: `Extension (${days} days) — ${g.sub.planName}`, unitCents: chargeCents }],
        },
        g.admin.id,
      );
      invoice = { id: inv.id, number: inv.number };
    }

    void emitMemberEvent("membership.renewed", {
      memberId: g.sub.memberId,
      locationId: g.sub.locationId,
      organizationId: g.sub.organizationId,
      actorAdminId: g.admin.id,
      refs: { subscriptionId: id, invoiceId: invoice?.id },
      vars: { planName: g.sub.planName, days, paidThrough: result.paidThroughDate?.toISOString() ?? null },
    });

    return NextResponse.json({ ok: true, subscription: result, invoice });
  } catch (e) {
    return apiError(e);
  }
}
