/**
 * Quo (formerly OpenPhone) webhook receiver.
 * Handles inbound SMS, delivery receipts, and opt-out keywords.
 */
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { isOptInMessage, isOptOutMessage, verifyQuoSignature } from "@/lib/quo";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-quo-signature") ?? req.headers.get("x-openphone-signature") ?? "";

  if (!verifyQuoSignature(signature, body)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const prisma = getPrisma();
  const externalId = event.id ?? event.event_id ?? null;

  const delivery = await prisma.webhookDelivery.upsert({
    where: { provider_externalId: { provider: "QUO", externalId: externalId ?? `${Date.now()}` } },
    create: {
      provider: "QUO",
      eventType: event.type ?? "unknown",
      externalId: externalId ?? `${Date.now()}`,
      payload: event,
      signature,
      status: "RECEIVED",
    },
    update: { attempts: { increment: 1 } },
  });

  try {
    await dispatchQuoEvent(event);
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[quo webhook] dispatch error", err);
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "FAILED", lastError: err.message ?? String(err), attempts: { increment: 1 } },
    });
    return NextResponse.json({ error: "dispatch failed" }, { status: 500 });
  }
}

async function dispatchQuoEvent(event: any): Promise<void> {
  const prisma = getPrisma();
  const type = event.type as string;

  if (type === "message.delivered" || type === "message.failed" || type === "message.read") {
    const providerId = event.data?.object?.id ?? event.data?.id;
    if (!providerId) return;
    const message = await prisma.message.findFirst({ where: { providerId } });
    if (!message) return;
    const status =
      type === "message.delivered" ? "DELIVERED" :
      type === "message.failed" ? "FAILED" :
      "OPENED";
    await prisma.message.update({
      where: { id: message.id },
      data: { status, openedAt: type === "message.read" ? new Date() : undefined },
    });
    return;
  }

  if (type === "message.received") {
    const data = event.data?.object ?? event.data ?? {};
    const fromNumber = data.from ?? data.from_number;
    const text = (data.text ?? data.body ?? "").trim();
    if (!fromNumber || !text) return;

    const member = await prisma.member.findFirst({ where: { phone: fromNumber } });

    // Opt-out / opt-in handling
    if (member) {
      if (isOptOutMessage(text)) {
        await prisma.member.update({
          where: { id: member.id },
          data: { optInSmsMarketing: false },
        });
        await audit({
          action: "member.update",
          entityType: "Member",
          entityId: member.id,
          before: { optInSmsMarketing: member.optInSmsMarketing },
          after: { optInSmsMarketing: false },
          metadata: { source: "quo_inbound_optout" },
        });
      } else if (isOptInMessage(text) && !member.optInSmsMarketing) {
        await prisma.member.update({
          where: { id: member.id },
          data: { optInSmsMarketing: true, smsConsentAt: new Date(), smsConsentSource: "quo_inbound_optin" },
        });
      }
    }

    let conversation = member
      ? await prisma.conversation.findFirst({
          where: { memberId: member.id, status: "OPEN" },
          orderBy: { lastMessageAt: "desc" },
        })
      : null;

    if (!conversation && member) {
      conversation = await prisma.conversation.create({
        data: { memberId: member.id, lastMessageAt: new Date() },
      });
    }

    await prisma.message.create({
      data: {
        conversationId: conversation?.id ?? null,
        memberId: member?.id ?? null,
        channel: "SMS",
        direction: "INBOUND",
        status: "DELIVERED",
        category: "TRANSACTIONAL",
        body: text,
        fromAddress: fromNumber,
        toAddress: data.to ?? null,
        providerId: data.id ?? null,
      },
    });

    if (conversation) {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      });
    }
    return;
  }

  console.log(`[quo webhook] unhandled type: ${type}`);
}
