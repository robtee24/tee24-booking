import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { emitMemberEvent } from "@/lib/events";
import { cancelSubscription } from "@/services/membership.service";
import { createInvoice } from "@/services/billing.service";
import { apiError, readJson, parseDate, toCents } from "@/app/api/admin/members/_shared";
import { requireSubscriptionApi } from "../_guard";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/memberships/[id]/cancel
 * { reason, notes?, timing: "immediate" | "end_of_period" | "date", date?, cancelFeeCents? | cancelFee? }
 * Permission membership.cancel (+ membership.cancel-immediate when immediate).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireSubscriptionApi(id);
  if (!g.ok) return g.response;
  const body = await readJson(req);
  try {
    assertCan(g.actor, "membership.cancel", { locationId: g.sub.locationId });
    const timing: string = body.timing ?? (body.immediate ? "immediate" : "end_of_period");
    const immediate = timing === "immediate";
    if (immediate) assertCan(g.actor, "membership.cancel-immediate", { locationId: g.sub.locationId });

    const reason = String(body.reason ?? "").trim();
    if (!reason) return NextResponse.json({ error: "A cancellation reason is required" }, { status: 400 });

    let extendDays: number | undefined = body.extendDays != null ? Number(body.extendDays) : undefined;
    if (timing === "date") {
      const date = parseDate(body.date);
      if (!date) return NextResponse.json({ error: "A cancellation date is required" }, { status: 400 });
      const sub = await getPrisma().membershipSubscription.findUnique({ where: { id }, select: { paidThroughDate: true, startDate: true } });
      const base = sub?.paidThroughDate ?? sub?.startDate ?? new Date();
      extendDays = Math.max(0, Math.round((date.getTime() - base.getTime()) / 86_400_000));
    }

    const result = await cancelSubscription(
      { subscriptionId: id, immediate, reason, notes: body.notes ?? undefined, refundUnusedCents: body.refundUnusedCents, extendDays, waiveEarlyCancelFee: body.waiveEarlyCancelFee === true },
      g.admin.id,
    );
    const { earlyCancelFee, ...subscription } = result;

    // Optional cancellation fee → one-off invoice
    const feeCents = body.cancelFeeCents != null ? Math.round(Number(body.cancelFeeCents)) : toCents(body.cancelFee);
    let feeInvoice: { id: string; number: number } | null = null;
    if (feeCents > 0) {
      const inv = await createInvoice(
        {
          organizationId: g.sub.organizationId,
          locationId: g.sub.locationId,
          memberId: g.sub.memberId,
          subscriptionId: id,
          description: `Cancellation fee — ${g.sub.planName}`,
          dueDate: new Date(),
          lines: [{ description: `Cancellation fee — ${g.sub.planName}`, unitCents: feeCents }],
        },
        g.admin.id,
      );
      feeInvoice = { id: inv.id, number: inv.number };
    }

    if (immediate) {
      await getPrisma().member.update({ where: { id: g.sub.memberId }, data: { status: "CANCELLED" } }).catch(() => undefined);
    }

    void emitMemberEvent(immediate ? "membership.cancelled" : "membership.cancel-scheduled", {
      memberId: g.sub.memberId,
      locationId: g.sub.locationId,
      organizationId: g.sub.organizationId,
      actorAdminId: g.admin.id,
      refs: { subscriptionId: id, invoiceId: feeInvoice?.id ?? earlyCancelFee?.invoiceId },
      vars: { planName: g.sub.planName, reason, cancelDate: result.cancelScheduledFor?.toISOString() ?? result.endDate?.toISOString() ?? null, feeCents: feeCents + (earlyCancelFee?.feeCents ?? 0) },
    });

    return NextResponse.json({ ok: true, subscription, feeInvoice, earlyCancelFee });
  } catch (e) {
    return apiError(e);
  }
}
