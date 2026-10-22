/**
 * Resend webhook receiver.
 *
 *  • email.sent / delivered / delivery_delayed / opened / clicked / bounced /
 *    complained → update the matching outbound Message (by provider id).
 *  • email.received → fetch the full body from the Receiving API and thread it
 *    into the inbox (`ingestInboundEmail`).
 *
 * Setup (Resend dashboard → Webhooks): endpoint `/api/webhooks/resend`, events
 * above, then store the signing secret as RESEND_WEBHOOK_SECRET. Receiving
 * also needs an API key with full access (the send-only key can't read mail).
 */
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getPrisma } from "@/lib/db";
import { ingestInboundEmail } from "@/services/inbox.service";
import { bareAddress, displayName, isAutomatedSender } from "@/lib/inbound-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type ResendEvent = {
  type?: string;
  created_at?: string;
  data?: Record<string, any>;
};

/** Standard-Webhooks / Svix signature: `${id}.${ts}.${body}` HMAC-SHA256, base64, "v1,<sig>" list. */
function verifySignature(req: NextRequest, body: string): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[resend webhook] RESEND_WEBHOOK_SECRET missing — accepting unverified");
    return true;
  }
  const id = req.headers.get("svix-id") ?? req.headers.get("webhook-id");
  const ts = req.headers.get("svix-timestamp") ?? req.headers.get("webhook-timestamp");
  const sig = req.headers.get("svix-signature") ?? req.headers.get("webhook-signature");
  if (!id || !ts || !sig) return false;
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return sig
    .split(" ")
    .map((s) => s.trim())
    .filter(Boolean)
    .some((entry) => {
      const v = entry.replace(/^v1,/, "");
      const a = Buffer.from(expected);
      const b = Buffer.from(v);
      return a.length === b.length && timingSafeEqual(a, b);
    });
}

const STATUS_BY_EVENT: Record<string, string> = {
  "email.sent": "SENT",
  "email.delivered": "DELIVERED",
  "email.delivery_delayed": "SENT",
  "email.opened": "OPENED",
  "email.clicked": "CLICKED",
  "email.bounced": "BOUNCED",
  "email.complained": "BOUNCED",
  "email.failed": "FAILED",
};

export async function POST(req: NextRequest) {
  const body = await req.text();
  if (!verifySignature(req, body)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const prisma = getPrisma();
  const type = event.type ?? "unknown";
  const data = event.data ?? {};
  const emailId: string | null = data.email_id ?? null;
  const externalId = `${type}:${emailId ?? req.headers.get("svix-id") ?? Date.now()}`;

  const delivery = await prisma.webhookDelivery.upsert({
    where: { provider_externalId: { provider: "RESEND", externalId } },
    create: { provider: "RESEND", eventType: type, externalId, payload: event as any, signature: req.headers.get("svix-signature") ?? null, status: "RECEIVED" },
    update: { attempts: { increment: 1 } },
  });

  try {
    let result: Record<string, unknown> = { handled: false };

    if (type === "email.received") {
      result = await handleReceived(data);
    } else if (STATUS_BY_EVENT[type] && emailId) {
      const msg = await prisma.message.findFirst({ where: { providerId: emailId, direction: "OUTBOUND" }, select: { id: true, status: true } });
      if (msg) {
        const status = STATUS_BY_EVENT[type];
        const now = new Date();
        // Never regress a richer status (OPENED → DELIVERED) when events arrive out of order.
        const rank: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, OPENED: 3, CLICKED: 4, BOUNCED: 5, FAILED: 5 };
        const next = (rank[status] ?? 0) >= (rank[msg.status] ?? 0) ? status : msg.status;
        await prisma.message.update({
          where: { id: msg.id },
          data: {
            status: next,
            openedAt: type === "email.opened" ? now : undefined,
            clickedAt: type === "email.clicked" ? now : undefined,
            bouncedAt: type === "email.bounced" || type === "email.complained" ? now : undefined,
            providerError:
              type === "email.bounced" ? `Bounced: ${data.bounce?.message ?? data.bounce?.subType ?? data.bounce?.type ?? "unknown"}`
              : type === "email.complained" ? "Recipient marked as spam"
              : type === "email.failed" ? data.failed?.reason ?? "Delivery failed"
              : undefined,
          },
        });
        result = { handled: true, status: next };
      }
    }

    await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { status: "PROCESSED", processedAt: new Date() } });
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[resend webhook] dispatch error", err);
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "FAILED", lastError: err?.message ?? String(err), attempts: { increment: 1 } },
    });
    return NextResponse.json({ error: "dispatch failed" }, { status: 500 });
  }
}

async function handleReceived(data: Record<string, any>): Promise<Record<string, unknown>> {
  const emailId: string | undefined = data.email_id;
  const from = bareAddress(data.from);
  const to: string[] = [...(data.to ?? []), ...(data.received_for ?? []), ...(data.cc ?? [])].map((x: string) => String(x));
  if (!emailId || !from) return { handled: false, reason: "missing id/from" };

  // Body/headers aren't in the webhook — fetch them.
  let html: string | null = null;
  let text: string | null = null;
  let headers: Record<string, string> | null = null;
  let fromName: string | null = displayName(data.from);
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      const full = (await res.json()) as Record<string, any>;
      html = full.html ?? null;
      text = full.text ?? null;
      headers = full.headers ?? null;
      fromName = fromName ?? displayName(full.headers?.from);
    } else {
      console.warn("[resend webhook] could not fetch received email", res.status, await res.text().catch(() => ""));
    }
  }
  if (isAutomatedSender(data.from ?? from, headers)) return { handled: false, reason: "automated sender" };

  const r = await ingestInboundEmail({
    from,
    fromName,
    to,
    subject: data.subject ?? null,
    html,
    text: text ?? (html ? null : "(body unavailable — Resend API key lacks receiving access)"),
    providerId: emailId,
    messageId: data.message_id ?? null,
    receivedAt: data.created_at ? new Date(data.created_at) : new Date(),
  });
  return { handled: true, ...r };
}
