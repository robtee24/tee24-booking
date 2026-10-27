import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { emitMemberEvent } from "@/lib/events";
import { freezeSubscription, unfreezeSubscription } from "@/services/membership.service";
import { createInvoice } from "@/services/billing.service";
import { apiError, parseDate, readJson, toCents } from "@/app/api/admin/members/_shared";
import { requireSubscriptionApi } from "../_guard";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/memberships/[id]/freeze
 * { startDate?, resumeDate, reason, feeCents? | fee?, immediate? }
 * Permission membership.freeze (+ membership.freeze-immediate when immediate).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireSubscriptionApi(id);
  if (!g.ok) return g.response;
  const body = await readJson(req);
  try {
    assertCan(g.actor, "membership.freeze", { locationId: g.sub.locationId });
    const resumeDate = parseDate(body.resumeDate);
    if (!resumeDate) return NextResponse.json({ error: "resumeDate is required" }, { status: 400 });
    const startDate = parseDate(body.startDate);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const immediate = body.immediate != null ? !!body.immediate : !startDate || startDate <= today;
    if (immediate) assertCan(g.actor, "membership.freeze-immediate", { locationId: g.sub.locationId });
    const feeCents = body.feeCents != null ? Math.round(Number(body.feeCents)) : toCents(body.fee);
    if (feeCents > 0) assertCan(g.actor, "membership.freeze", { locationId: g.sub.locationId });

    const result = await freezeSubscription(
      { subscriptionId: id, immediate, startDate, resumeDate, feeCents, reason: String(body.reason ?? "").trim() || "Freeze" },
      g.admin.id,
    );

    let feeInvoice: { id: string; number: number } | null = null;
    if (feeCents > 0) {
      const inv = await createInvoice(
        {
          organizationId: g.sub.organizationId,
          locationId: g.sub.locationId,
          memberId: g.sub.memberId,
          subscriptionId: id,
          description: `Freeze fee — ${g.sub.planName}`,
          dueDate: new Date(),
          lines: [{ description: `Freeze fee — ${g.sub.planName}`, unitCents: feeCents }],
        },
        g.admin.id,
      );
      feeInvoice = { id: inv.id, number: inv.number };
    }

    if (immediate) await getPrisma().member.update({ where: { id: g.sub.memberId }, data: { status: "FROZEN" } }).catch(() => undefined);

    const fmt = (d: Date | null | undefined) =>
      d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
    void emitMemberEvent(immediate ? "membership.frozen" : "membership.freeze-scheduled", {
      memberId: g.sub.memberId,
      locationId: g.sub.locationId,
      organizationId: g.sub.organizationId,
      actorAdminId: g.admin.id,
      refs: { subscriptionId: id, invoiceId: feeInvoice?.id },
      vars: {
        planName: g.sub.planName,
        freezeStart: fmt(result.freezeStartDate ?? startDate),
        dueDate: fmt(resumeDate),
        resumeDate: fmt(resumeDate),
        feeCents,
      },
    });

    return NextResponse.json({ ok: true, subscription: result, feeInvoice });
  } catch (e) {
    return apiError(e);
  }
}

/** DELETE /api/admin/memberships/[id]/freeze — unfreeze now. Permission membership.freeze */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireSubscriptionApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "membership.freeze", { locationId: g.sub.locationId });
    const result = await unfreezeSubscription(id, g.admin.id);
    await getPrisma().member.updateMany({ where: { id: g.sub.memberId, status: "FROZEN" }, data: { status: "ACTIVE" } }).catch(() => undefined);
    void emitMemberEvent("membership.resumed", {
      memberId: g.sub.memberId,
      locationId: g.sub.locationId,
      organizationId: g.sub.organizationId,
      actorAdminId: g.admin.id,
      refs: { subscriptionId: id },
      vars: { planName: g.sub.planName },
    });
    return NextResponse.json({ ok: true, subscription: result });
  } catch (e) {
    return apiError(e);
  }
}
