/**
 * Square webhook receiver.
 * Persists every delivery to WebhookDelivery for replay + audit, then dispatches
 * to the appropriate handler. Idempotent on Square's event id.
 */
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { verifySquareSignature } from "@/lib/square";
import { audit } from "@/lib/audit";
import { applyAccessState } from "@/lib/access-sync";
import { adminNotify } from "@/lib/admin-notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-square-hmacsha256-signature") ?? "";
  const notificationUrl = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL ?? new URL(req.url).toString();

  if (!verifySquareSignature({ body, signature, notificationUrl })) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const prisma = getPrisma();
  const externalId = event.event_id ?? event.id ?? null;

  const delivery = await prisma.webhookDelivery.upsert({
    where: { provider_externalId: { provider: "SQUARE", externalId: externalId ?? `${Date.now()}` } },
    create: {
      provider: "SQUARE",
      eventType: event.type ?? "unknown",
      externalId: externalId ?? `${Date.now()}`,
      payload: event,
      signature,
      status: "RECEIVED",
    },
    update: { attempts: { increment: 1 } },
  });

  try {
    await dispatchSquareEvent(event);
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[square webhook] dispatch error", err);
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "FAILED", lastError: err.message ?? String(err), attempts: { increment: 1 } },
    });
    return NextResponse.json({ error: "dispatch failed" }, { status: 500 });
  }
}

async function dispatchSquareEvent(event: any): Promise<void> {
  const prisma = getPrisma();
  const type = event.type as string;
  const data = event?.data?.object ?? {};

  switch (type) {
    case "payment.created":
    case "payment.updated": {
      const payment = data.payment;
      if (!payment) return;
      const charge = await prisma.charge.findFirst({ where: { squarePaymentId: payment.id } });
      if (!charge) return;
      const status =
        payment.status === "COMPLETED" ? "SUCCEEDED" :
        payment.status === "FAILED" ? "FAILED" :
        payment.status === "CANCELED" ? "FAILED" :
        "PENDING";
      await prisma.charge.update({
        where: { id: charge.id },
        data: {
          status,
          failureReason: payment.failure_reason ?? null,
        },
      });
      if (status === "SUCCEEDED" && charge.invoiceId) {
        await prisma.invoice.update({
          where: { id: charge.invoiceId },
          data: { status: "PAID", paidAt: new Date() },
        });
        if (charge.memberId) {
          await applyAccessState(charge.memberId, { enabled: true, reason: "payment_recovered" }).catch(() => {});
        }
      }
      if (status === "FAILED" && charge.memberId) {
        await adminNotify({
          locationId: charge.locationId,
          kind: "payment.failed",
          severity: "WARN",
          title: "Payment failed",
          body: `Square charge for $${(charge.amountCents / 100).toFixed(2)} failed: ${payment.failure_reason ?? "unknown"}`,
          data: { chargeId: charge.id, memberId: charge.memberId },
        });
        await audit({
          action: "billing.charge",
          entityType: "Charge",
          entityId: charge.id,
          metadata: { source: "square_webhook", status: "FAILED" },
        });
      }
      break;
    }

    case "invoice.payment_made": {
      const invoice = data.invoice;
      if (!invoice) return;
      const ours = await prisma.invoice.findFirst({ where: { squareInvoiceId: invoice.id } });
      if (!ours) return;
      await prisma.invoice.update({
        where: { id: ours.id },
        data: { status: "PAID", paidAt: new Date() },
      });
      break;
    }

    case "subscription.updated": {
      const subscription = data.subscription;
      if (!subscription) return;
      const ours = await prisma.membershipSubscription.findFirst({
        where: { squareSubscriptionId: subscription.id },
      });
      if (!ours) return;
      const status =
        subscription.status === "ACTIVE" ? "ACTIVE" :
        subscription.status === "PAUSED" ? "FROZEN" :
        subscription.status === "CANCELED" ? "CANCELLED" :
        ours.status;
      await prisma.membershipSubscription.update({
        where: { id: ours.id },
        data: { status },
      });
      break;
    }

    case "dispute.created": {
      const dispute = data.dispute;
      if (!dispute) return;
      const charge = await prisma.charge.findFirst({
        where: { squarePaymentId: dispute.disputed_payment?.payment_id },
      });
      if (!charge) return;
      await prisma.charge.update({
        where: { id: charge.id },
        data: { status: "DISPUTED" },
      });
      if (charge.invoiceId) {
        await prisma.invoice.update({
          where: { id: charge.invoiceId },
          data: { status: "CHARGEBACK" },
        });
      }
      if (charge.memberId) {
        await applyAccessState(charge.memberId, { enabled: false, reason: "chargeback" }).catch(() => {});
        await adminNotify({
          locationId: charge.locationId,
          kind: "payment.chargeback",
          severity: "ERROR",
          title: "Chargeback received",
          body: `A chargeback was filed on a $${(charge.amountCents / 100).toFixed(2)} payment.`,
          data: { chargeId: charge.id, memberId: charge.memberId },
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
