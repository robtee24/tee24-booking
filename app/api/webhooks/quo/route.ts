/**
 * Quo (formerly OpenPhone) webhook receiver.
 * Handles inbound SMS (→ Inbox conversation, lead auto-create, STOP/START),
 * and delivery receipts for outbound messages.
 */
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { verifyQuoSignature } from "@/lib/quo";
import { ingestInboundSms } from "@/services/inbox.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-quo-signature") ?? req.headers.get("x-openphone-signature") ?? req.headers.get("openphone-signature") ?? "";

  if (!verifyQuoSignature(signature, body)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: QuoEvent;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const prisma = getPrisma();
  const externalId: string = event.id ?? event.event_id ?? event.data?.object?.id ?? `${Date.now()}`;

  const delivery = await prisma.webhookDelivery.upsert({
    where: { provider_externalId: { provider: "QUO", externalId } },
    create: {
      provider: "QUO",
      eventType: event.type ?? "unknown",
      externalId,
      payload: event,
      signature,
      status: "RECEIVED",
    },
    update: { attempts: { increment: 1 } },
  });

  try {
    const result = await dispatchQuoEvent(event);
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[quo webhook] dispatch error", err);
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "FAILED", lastError: err instanceof Error ? err.message : String(err), attempts: { increment: 1 } },
    });
    return NextResponse.json({ error: "dispatch failed" }, { status: 500 });
  }
}

function firstString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return null;
}

// Loose payload shape: Quo/OpenPhone wrap the object under data.object; older payloads put fields on data directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QuoPayload = Record<string, any>;
type QuoEvent = { id?: string; event_id?: string; type?: string; event?: string; data?: QuoPayload & { object?: QuoPayload } };

async function dispatchQuoEvent(event: QuoEvent): Promise<Record<string, unknown>> {
  const prisma = getPrisma();
  const type = String(event.type ?? event.event ?? "");
  const data: QuoPayload = event.data?.object ?? event.data ?? {};

  // Delivery receipts for our outbound messages
  if (type === "message.delivered" || type === "message.failed" || type === "message.read" || type === "message.sent") {
    const providerId = data.id;
    if (!providerId) return { handled: false };
    const message = await prisma.message.findFirst({ where: { providerId, direction: "OUTBOUND" } });
    if (!message) return { handled: false };
    const status =
      type === "message.delivered" ? "DELIVERED" :
      type === "message.failed" ? "FAILED" :
      type === "message.read" ? "OPENED" : "SENT";
    await prisma.message.update({
      where: { id: message.id },
      data: {
        status,
        openedAt: type === "message.read" ? new Date() : undefined,
        providerError: type === "message.failed" ? data.errorMessage ?? data.error ?? "Delivery failed" : undefined,
      },
    });
    return { handled: true, status };
  }

  if (type === "message.received") {
    // Outbound messages echo back as message.received with direction "outgoing" on some Quo plans — ignore those.
    if ((data.direction ?? "incoming") !== "incoming") return { handled: false, reason: "outgoing echo" };
    const fromNumber = firstString(data.from) ?? firstString(data.from_number);
    const toNumber = firstString(data.to) ?? firstString(data.to_number);
    const text = String(data.text ?? data.body ?? data.content ?? "").trim();
    if (!fromNumber || !text) return { handled: false, reason: "missing from/text" };

    const res = await ingestInboundSms({
      from: fromNumber,
      to: toNumber,
      text,
      providerId: data.id ?? null,
      receivedAt: data.createdAt ? new Date(data.createdAt) : new Date(),
    });
    return { handled: true, ...res };
  }

  console.log(`[quo webhook] unhandled type: ${type}`);
  return { handled: false };
}
