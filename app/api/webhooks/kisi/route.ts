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
  // Kisi's event webhook integration signs the body as HMAC-SHA256 in `X-Signature`.
  const signature = req.headers.get("x-signature") ?? req.headers.get("x-kisi-signature") ?? "";

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
  const externalId = event.uuid ?? event.id ?? event.event_id ?? null;

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
    const type: string = event.type ?? event.event_type ?? "";
    const isUnlock = type === "lock.unlock" || type === "unlock";
    const success = event.success !== false;
    const hasActor = Boolean(event.actor_email || event.actor_id != null || event.user_id != null || event.user?.id);
    if (isUnlock && success && hasActor) {
      // Modern Kisi event shape: actor_* (user), object_* (lock). Legacy shape: user_id / lock_id.
      const actorIsUser = !event.actor_type || event.actor_type === "User";
      const kisiUserId = actorIsUser
        ? event.actor_id ?? event.user_id ?? event.user?.id ?? null
        : event.user_id ?? null;
      const lockId =
        event.object_type === "Lock" || event.object_type == null
          ? event.object_id ?? event.lock_id ?? event.lock?.id ?? event.door?.id ?? null
          : event.lock_id ?? null;
      await ingestKisiUnlock({
        kisiEventId: String(externalId ?? `${Date.now()}`),
        kisiUserId: kisiUserId != null ? String(kisiUserId) : null,
        kisiDoorId: lockId != null ? String(lockId) : null,
        actorEmail: event.actor_email ?? event.user?.email ?? null,
        actorName: event.actor_name ?? event.user?.name ?? null,
        doorName: event.object_name ?? event.lock?.name ?? event.door?.name ?? null,
        kisiPlaceId: typeof event.place_id === "number" ? event.place_id : null,
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
