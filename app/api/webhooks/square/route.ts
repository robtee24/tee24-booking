/**
 * Square webhook receiver.
 *
 * Persists every delivery to WebhookDelivery for replay + audit, then dispatches
 * to the appropriate handler. Idempotent on Square's event id: a redelivered
 * event that was already PROCESSED is acknowledged without re-running side
 * effects, and every handler is itself idempotent (state transitions are
 * guarded by the current DB state).
 *
 * Handled:
 *   payment.created / payment.updated   → Charge status; invoice paid/failed via billing.service
 *   refund.created / refund.updated     → mirror Refund rows (external refunds from Square dashboard too)
 *   card.updated / card.disabled / card.forgotten → PaymentMethod expiry/status (+ card.expired event)
 *   dispute.created                     → CHARGEBACK + access block
 *   invoice.payment_made / subscription.updated → legacy Square-hosted objects
 *
 * Env: SQUARE_WEBHOOK_SIGNATURE_KEY (required to accept), optional
 *      SQUARE_WEBHOOK_NOTIFICATION_URL (defaults to the request URL).
 */
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { verifySquareSignature } from "@/lib/square";
import { audit } from "@/lib/audit";
import { applyAccessState } from "@/lib/access-sync";
import { adminNotify } from "@/lib/admin-notify";
import { emitMemberEvent } from "@/lib/events";
import { onInvoicePaid, onInvoiceChargeFailed, PAID_STATUSES } from "@/services/billing.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SquareEvent = {
  event_id?: string;
  id?: string;
  type?: string;
  created_at?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Square payload shapes vary per event type
  data?: { type?: string; id?: string; object?: Record<string, any> };
};

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-square-hmacsha256-signature") ?? "";
  const notificationUrl = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL ?? new URL(req.url).toString();

  if (!process.env.SQUARE_WEBHOOK_SIGNATURE_KEY) {
    return NextResponse.json({ error: "SQUARE_WEBHOOK_SIGNATURE_KEY not configured" }, { status: 503 });
  }
  if (!verifySquareSignature({ body, signature, notificationUrl })) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: SquareEvent;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const prisma = getPrisma();
  const externalId = event.event_id ?? event.id ?? `${event.type ?? "unknown"}_${Date.now()}`;

  const existing = await prisma.webhookDelivery.findUnique({ where: { provider_externalId: { provider: "SQUARE", externalId } } });
  if (existing?.status === "PROCESSED") {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const delivery = existing
    ? await prisma.webhookDelivery.update({ where: { id: existing.id }, data: { attempts: { increment: 1 }, status: "RETRYING" } })
    : await prisma.webhookDelivery.create({
        data: { provider: "SQUARE", eventType: event.type ?? "unknown", externalId, payload: event as object, signature, status: "RECEIVED", attempts: 1 },
      });

  try {
    await dispatchSquareEvent(event);
    await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { status: "PROCESSED", processedAt: new Date(), lastError: null } });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error("[square webhook] dispatch error", err);
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "FAILED", lastError: err instanceof Error ? err.message : String(err) },
    });
    return NextResponse.json({ error: "dispatch failed" }, { status: 500 });
  }
}

async function dispatchSquareEvent(event: SquareEvent): Promise<void> {
  const prisma = getPrisma();
  const type = event.type ?? "";
  const data = event.data?.object ?? {};

  switch (type) {
    case "payment.created":
    case "payment.updated": {
      const payment = data.payment;
      if (!payment?.id) return;
      const charge = await prisma.charge.findFirst({ where: { squarePaymentId: payment.id }, include: { invoice: { select: { id: true, status: true } } } });
      // Payments we did not initiate (e.g. Square POS) are stored only as WebhookDelivery.
      if (!charge) return;

      const squareStatus = String(payment.status ?? "");
      const status =
        squareStatus === "COMPLETED" || squareStatus === "APPROVED" ? "SUCCEEDED" :
        squareStatus === "FAILED" || squareStatus === "CANCELED" ? "FAILED" :
        "PENDING";
      const failureReason: string | null =
        payment.failure_reason ?? payment.card_details?.errors?.[0]?.detail ?? payment.card_details?.status ?? null;

      if (charge.status !== status || (failureReason && charge.failureReason !== failureReason)) {
        await prisma.charge.update({
          where: { id: charge.id },
          data: { status: charge.status === "REFUNDED" || charge.status === "PARTIALLY_REFUNDED" || charge.status === "DISPUTED" ? charge.status : status, failureReason: failureReason ?? undefined },
        });
      }

      if (charge.invoiceId && charge.invoice) {
        if (status === "SUCCEEDED" && !(PAID_STATUSES as readonly string[]).includes(charge.invoice.status)) {
          await onInvoicePaid(charge.invoiceId, { paidCents: charge.amountCents, method: "CARD", chargeId: charge.id });
        } else if (status === "FAILED" && charge.invoice.status !== "PAST_DUE" && !(PAID_STATUSES as readonly string[]).includes(charge.invoice.status)) {
          await onInvoiceChargeFailed(charge.invoiceId, { reason: failureReason ?? `Square status ${squareStatus}`, chargeId: charge.id });
        }
      }
      void audit({ organizationId: charge.organizationId, action: "billing.charge", entityType: "Charge", entityId: charge.id, metadata: { source: "square_webhook", status, squareStatus } });
      break;
    }

    case "refund.created":
    case "refund.updated": {
      const refund = data.refund;
      if (!refund?.id || !refund.payment_id) return;
      const charge = await prisma.charge.findFirst({ where: { squarePaymentId: refund.payment_id }, include: { refunds: true, invoice: true } });
      if (!charge) return;
      const amountCents = Number(refund.amount_money?.amount ?? 0);
      const status = String(refund.status ?? "PENDING"); // PENDING | COMPLETED | REJECTED | FAILED

      const ours = charge.refunds.find((r) => r.squareRefundId === refund.id);
      if (ours) {
        if (ours.status !== status) await prisma.refund.update({ where: { id: ours.id }, data: { status } });
        if (status !== "COMPLETED" || ours.status === "COMPLETED") break; // already reconciled
      } else {
        // Refund initiated outside the app (Square Dashboard). Mirror it.
        await prisma.refund.create({
          data: { chargeId: charge.id, invoiceId: charge.invoiceId, amountCents, reason: refund.reason ?? "Refunded in Square", squareRefundId: refund.id, status },
        });
        if (status !== "COMPLETED") break;
      }

      // Reconcile charge + invoice totals from completed refunds.
      const completed = await prisma.refund.aggregate({ where: { chargeId: charge.id, status: "COMPLETED" }, _sum: { amountCents: true } });
      const refundedCents = completed._sum.amountCents ?? 0;
      const chargeStatus = refundedCents >= charge.amountCents ? "REFUNDED" : refundedCents > 0 ? "PARTIALLY_REFUNDED" : charge.status;
      await prisma.charge.update({ where: { id: charge.id }, data: { status: chargeStatus } });
      if (charge.invoice) {
        const invRefunded = await prisma.refund.aggregate({ where: { invoiceId: charge.invoice.id, status: "COMPLETED" }, _sum: { amountCents: true } });
        const invRefundedCents = invRefunded._sum.amountCents ?? 0;
        await prisma.invoice.update({
          where: { id: charge.invoice.id },
          data: { refundedCents: invRefundedCents, status: invRefundedCents >= charge.invoice.totalCents ? "REFUNDED" : invRefundedCents > 0 ? "PARTIALLY_REFUNDED" : charge.invoice.status },
        });
      }
      if (!ours) {
        await emitMemberEvent("payment.refunded", {
          memberId: charge.memberId,
          locationId: charge.locationId,
          organizationId: charge.organizationId,
          refs: { chargeId: charge.id, invoiceId: charge.invoiceId ?? undefined },
          vars: { amount: (amountCents / 100).toFixed(2), reason: refund.reason ?? "Refunded in Square" },
        });
        await adminNotify({
          organizationId: charge.organizationId ?? undefined,
          locationId: charge.locationId ?? undefined,
          kind: "payment.refunded",
          severity: "INFO",
          title: "Refund issued from Square",
          body: `$${(amountCents / 100).toFixed(2)} refunded in the Square dashboard.`,
          data: { chargeId: charge.id, memberId: charge.memberId, squareRefundId: refund.id },
        });
      }
      break;
    }

    case "card.created":
    case "card.updated":
    case "card.disabled":
    case "card.forgotten": {
      const card = data.card;
      if (!card?.id) return;
      const pm = await prisma.paymentMethod.findUnique({ where: { squareCardId: card.id }, include: { member: { select: { id: true, locationId: true, organizationId: true } } } });
      if (!pm) return;
      const disabled = type === "card.disabled" || type === "card.forgotten" || card.enabled === false;
      const expMonth = card.exp_month ? Number(card.exp_month) : pm.expMonth;
      const expYear = card.exp_year ? Number(card.exp_year) : pm.expYear;
      const now = new Date();
      const expired = !!expMonth && !!expYear && (expYear < now.getFullYear() || (expYear === now.getFullYear() && expMonth < now.getMonth() + 1));
      const nextStatus = disabled || expired ? "EXPIRED" : pm.status === "EXPIRED" ? "ACTIVE" : pm.status;
      await prisma.paymentMethod.update({
        where: { id: pm.id },
        data: { brand: card.card_brand ?? pm.brand, last4: card.last_4 ?? pm.last4, expMonth, expYear, status: nextStatus, isDefault: disabled ? false : pm.isDefault },
      });
      if (nextStatus === "EXPIRED" && pm.status !== "EXPIRED") {
        await emitMemberEvent("card.expired", {
          memberId: pm.memberId,
          locationId: pm.member.locationId,
          organizationId: pm.member.organizationId,
          vars: { brand: card.card_brand ?? pm.brand ?? "Card", last4: card.last_4 ?? pm.last4 ?? "", reason: disabled ? "disabled" : "expired" },
        });
      }
      break;
    }

    case "invoice.payment_made": {
      const invoice = data.invoice;
      if (!invoice?.id) return;
      const ours = await prisma.invoice.findFirst({ where: { squareInvoiceId: invoice.id } });
      if (!ours || (PAID_STATUSES as readonly string[]).includes(ours.status)) return;
      await onInvoicePaid(ours.id, { paidCents: ours.totalCents - ours.refundedCents, method: "SQUARE_INVOICE" });
      break;
    }

    case "subscription.updated": {
      const subscription = data.subscription;
      if (!subscription?.id) return;
      const ours = await prisma.membershipSubscription.findFirst({ where: { squareSubscriptionId: subscription.id } });
      if (!ours) return;
      const status =
        subscription.status === "ACTIVE" ? "ACTIVE" :
        subscription.status === "PAUSED" ? "FROZEN" :
        subscription.status === "CANCELED" ? "CANCELLED" :
        ours.status;
      if (status !== ours.status) await prisma.membershipSubscription.update({ where: { id: ours.id }, data: { status } });
      break;
    }

    case "dispute.created": {
      const dispute = data.dispute;
      const paymentId = dispute?.disputed_payment?.payment_id;
      if (!paymentId) return;
      const charge = await prisma.charge.findFirst({ where: { squarePaymentId: paymentId } });
      if (!charge || charge.status === "DISPUTED") return;
      await prisma.charge.update({ where: { id: charge.id }, data: { status: "DISPUTED" } });
      if (charge.invoiceId) {
        await prisma.invoice.update({ where: { id: charge.invoiceId }, data: { status: "CHARGEBACK" } });
      }
      if (charge.memberId) {
        await applyAccessState(charge.memberId, { enabled: false, reason: "chargeback" }).catch(() => {});
        await adminNotify({
          organizationId: charge.organizationId ?? undefined,
          locationId: charge.locationId ?? undefined,
          kind: "payment.chargeback",
          severity: "ERROR",
          title: "Chargeback received",
          body: `A chargeback was filed on a $${(charge.amountCents / 100).toFixed(2)} payment.`,
          data: { chargeId: charge.id, memberId: charge.memberId, disputeId: dispute.id },
        });
      }
      break;
    }

    default:
      // Unhandled event type — already persisted to WebhookDelivery for inspection
      console.log(`[square webhook] unhandled type: ${type}`);
      break;
  }
}
