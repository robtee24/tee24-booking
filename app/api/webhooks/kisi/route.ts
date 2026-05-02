/**
 * Kisi webhook receiver.
 * Persists every delivery to WebhookDelivery for replay + audit, then routes
 * door unlock events into the Visit dedupe pipeline.
 */
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { verifyKisiSignature } from "@/lib/kisi";
import { ingestKisiUnlock } from "@/services/attendance.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-kisi-signature") ?? "";

  if (!verifyKisiSignature({ body, signature })) {
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
    where: { provider_externalId: { provider: "KISI", externalId: externalId ?? `${Date.now()}` } },
    create: {
      provider: "KISI",
      eventType: event.type ?? event.event_type ?? "unknown",
      externalId: externalId ?? `${Date.now()}`,
      payload: event,
      signature,
      status: "RECEIVED",
    },
    update: { attempts: { increment: 1 } },
  });

  try {
    if (event.type === "unlock" || event.event_type === "unlock") {
      await ingestKisiUnlock({
        kisiEventId: String(externalId ?? `${Date.now()}`),
        kisiUserId: event.user_id ? String(event.user_id) : event.user?.id ? String(event.user.id) : null,
        kisiDoorId: event.lock_id ? String(event.lock_id) : event.door?.id ? String(event.door.id) : null,
        unlockedAt: new Date(event.created_at ?? event.timestamp ?? Date.now()),
        rawEvent: event,
      });
    }
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[kisi webhook] dispatch error", err);
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "FAILED", lastError: err.message ?? String(err), attempts: { increment: 1 } },
    });
    return NextResponse.json({ error: "dispatch failed" }, { status: 500 });
  }
}
