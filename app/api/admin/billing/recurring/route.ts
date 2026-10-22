/**
 * POST  /api/admin/billing/recurring  { locationSlug, memberId, name, amountCents, cadence, startDate }
 *        → create a standalone recurring charge (hidden plan + subscription)           (billing.charge)
 * POST  /api/admin/billing/recurring?action=run { locationSlug, subscriptionId? }
 *        → run invoice generation now                                                    (billing.charge)
 * PATCH /api/admin/billing/recurring { subscriptionId, autoRenew?, nextInvoiceDate? }   (billing.edit-invoice)
 */
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { createAdHocRecurringCharge, generateDueInvoices, setNextInvoiceDate, setSubscriptionAutoRenew } from "@/services/recurring-billing.service";
import { errorResponse, guardBilling, parseDate } from "../_shared";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const g = await guardBilling({ locationSlug: body.locationSlug, locationId: body.locationId }, "billing.charge");
  if (!g.ok) return g.response;
  try {
    if (req.nextUrl.searchParams.get("action") === "run") {
      const r = await generateDueInvoices(new Date(), { subscriptionId: body.subscriptionId || undefined, actorId: g.actorId });
      return NextResponse.json({ ok: true, ...r });
    }
    const startDate = parseDate(body.startDate) ?? new Date();
    const r = await createAdHocRecurringCharge({
      locationId: g.location.id,
      memberId: String(body.memberId ?? ""),
      name: String(body.name ?? ""),
      amountCents: Math.round(Number(body.amountCents)),
      cadence: String(body.cadence ?? "MONTHLY"),
      startDate,
      actorId: g.actorId,
    });
    return NextResponse.json({ ok: true, subscriptionId: r.subscription.id, planId: r.plan.id, generated: r.generated });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sub = await getPrisma().membershipSubscription.findUnique({ where: { id: String(body.subscriptionId ?? "") }, select: { id: true, locationId: true } });
  if (!sub) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  const g = await guardBilling({ locationId: sub.locationId }, "billing.edit-invoice");
  if (!g.ok) return g.response;
  try {
    let updated = null;
    if (typeof body.autoRenew === "boolean") updated = await setSubscriptionAutoRenew(sub.id, body.autoRenew, g.actorId);
    const next = parseDate(body.nextInvoiceDate);
    if (next) updated = await setNextInvoiceDate(sub.id, next, g.actorId);
    return NextResponse.json({ ok: true, subscription: updated });
  } catch (e) {
    return errorResponse(e);
  }
}
