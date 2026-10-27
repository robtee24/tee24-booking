import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { emitMemberEvent } from "@/lib/events";
import { cancelNowAndRefund, cancelSubscription, lastMembershipPayment } from "@/services/membership.service";
import { createInvoice } from "@/services/billing.service";
import { membershipDisplayName } from "@/lib/membership-pricing";
import { apiError, readJson, parseDate, toCents } from "@/app/api/admin/members/_shared";
import { requireSubscriptionApi } from "../_guard";

export const dynamic = "force-dynamic";

function fmtDate(d: Date | null | undefined) {
  if (!d) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** GET /api/admin/memberships/[id]/cancel — last refundable membership payment (for the Cancel now & refund modal). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireSubscriptionApi(id);
  if (!g.ok) return g.response;
  try {
    const lastPayment = await lastMembershipPayment(id);
    return NextResponse.json({
      ok: true,
      lastPayment: lastPayment
        ? { ...lastPayment, paidAt: lastPayment.paidAt.toISOString() }
        : null,
    });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * POST /api/admin/memberships/[id]/cancel
 * { reason, notes?, timing: "end_of_period" | "date" | "immediate", date?, refundLastPayment?, cancelFeeCents? }
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireSubscriptionApi(id);
  if (!g.ok) return g.response;
  const body = await readJson(req);
  try {
    assertCan(g.actor, "membership.cancel", { locationId: g.sub.locationId });
    const reason = String(body.reason ?? "").trim();
    if (!reason) return NextResponse.json({ error: "A cancellation reason is required" }, { status: 400 });

    const refundLastPayment = body.refundLastPayment === true || body.timing === "cancel_now_refund";
    if (refundLastPayment) {
      assertCan(g.actor, "membership.cancel-immediate", { locationId: g.sub.locationId });
      assertCan(g.actor, "billing.refund", { locationId: g.sub.locationId });
      const result = await cancelNowAndRefund(
        { subscriptionId: id, reason, notes: body.notes ?? undefined, refundLastPayment: true, refundAmountCents: body.refundAmountCents != null ? Math.round(Number(body.refundAmountCents)) : undefined },
        g.admin.id,
      );
      return NextResponse.json({ ok: true, ...result });
    }

    const timing: string = body.timing ?? (body.immediate ? "immediate" : "end_of_period");
    const immediate = timing === "immediate";
    if (immediate) assertCan(g.actor, "membership.cancel-immediate", { locationId: g.sub.locationId });

    let extendDays: number | undefined = body.extendDays != null ? Number(body.extendDays) : undefined;
    if (timing === "date") {
      const date = parseDate(body.date);
      if (!date) return NextResponse.json({ error: "A cancellation date is required" }, { status: 400 });
      const sub = await getPrisma().membershipSubscription.findUnique({ where: { id }, select: { paidThroughDate: true, startDate: true } });
      const base = sub?.paidThroughDate ?? sub?.startDate ?? new Date();
      extendDays = Math.max(0, Math.round((date.getTime() - base.getTime()) / 86_400_000));
    }

    const result = await cancelSubscription(
      { subscriptionId: id, immediate, reason, notes: body.notes ?? undefined, extendDays, waiveEarlyCancelFee: body.waiveEarlyCancelFee === true },
      g.admin.id,
    );
    const { earlyCancelFee, ...subscription } = result;

    const feeCents = body.cancelFeeCents != null ? Math.round(Number(body.cancelFeeCents)) : toCents(body.cancelFee);
    let feeInvoice: { id: string; number: number } | null = null;
    if (feeCents > 0) {
      const inv = await createInvoice(
        {
          organizationId: g.sub.organizationId,
          locationId: g.sub.locationId,
          memberId: g.sub.memberId,
          description: `Cancellation fee — ${g.sub.planName}`,
          dueDate: new Date(),
          lines: [{ description: `Cancellation fee — ${g.sub.planName}`, unitCents: feeCents }],
        },
        g.admin.id,
      );
      feeInvoice = { id: inv.id, number: inv.number };
    }

    const due = immediate ? new Date() : result.cancelScheduledFor ?? result.endDate;
    void emitMemberEvent(immediate ? "membership.cancelled" : "membership.cancel-scheduled", {
      memberId: g.sub.memberId,
      locationId: g.sub.locationId,
      organizationId: g.sub.organizationId,
      actorAdminId: g.admin.id,
      refs: { subscriptionId: id, invoiceId: feeInvoice?.id ?? earlyCancelFee?.invoiceId },
      vars: { planName: g.sub.planName ?? membershipDisplayName(g.sub.planName, 0), reason, dueDate: fmtDate(due) },
    });

    return NextResponse.json({ ok: true, subscription, feeInvoice, earlyCancelFee });
  } catch (e) {
    return apiError(e);
  }
}
