import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { emitMemberEvent } from "@/lib/events";
import { changePlan } from "@/services/membership.service";
import { createInvoice } from "@/services/billing.service";
import { apiError, readJson } from "@/app/api/admin/members/_shared";
import { requireSubscriptionApi } from "../_guard";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/memberships/[id]/change-plan { newPlanId, proration?: "RETROACTIVE"|"PROSPECTIVE"|"NONE", invoiceProration?: boolean }
 * Permission membership.subscribe
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireSubscriptionApi(id);
  if (!g.ok) return g.response;
  const body = await readJson(req);
  try {
    assertCan(g.actor, "membership.subscribe", { locationId: g.sub.locationId });
    if (!body.newPlanId) return NextResponse.json({ error: "newPlanId required" }, { status: 400 });
    const proration = ["RETROACTIVE", "PROSPECTIVE", "NONE"].includes(body.proration) ? body.proration : "PROSPECTIVE";
    const { subscription, prorationCents } = await changePlan({ subscriptionId: id, newPlanId: String(body.newPlanId), proration, actorId: g.admin.id });

    const newPlan = await getPrisma().membershipPlan.findUnique({ where: { id: subscription.planId }, select: { name: true } });
    await getPrisma().member.update({ where: { id: g.sub.memberId }, data: { membershipType: newPlan?.name ?? null } }).catch(() => undefined);

    let invoice: { id: string; number: number } | null = null;
    if (body.invoiceProration !== false && prorationCents > 0) {
      const inv = await createInvoice(
        {
          organizationId: g.sub.organizationId,
          locationId: g.sub.locationId,
          memberId: g.sub.memberId,
          subscriptionId: id,
          description: `Plan change proration — ${g.sub.planName} → ${newPlan?.name ?? "new plan"}`,
          dueDate: new Date(),
          lines: [{ description: `Prorated upgrade to ${newPlan?.name ?? "new plan"}`, unitCents: prorationCents }],
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
      vars: { planName: newPlan?.name ?? "", previousPlanName: g.sub.planName, prorationCents, planChange: "yes" },
    });

    return NextResponse.json({ ok: true, subscription, prorationCents, invoice });
  } catch (e) {
    return apiError(e);
  }
}
