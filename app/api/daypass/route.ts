/**
 * Day-pass guest checkout endpoint.
 *
 * - No account creation for the guest (a lightweight VISITOR Member row is
 *   created/reused so the payment shows up as a PAID Invoice in Billing)
 * - Captures Visitor record (+ lead.created event)
 * - When Square is configured: charges the day-pass plan price (+ location tax)
 *   with the Web Payments SDK token BEFORE provisioning access. Declines → 402.
 * - When Square is NOT configured: behaves exactly as before (no charge).
 * - Creates a 24h Kisi credential (best-effort; nightly reconciliation cleans up)
 * - Sends Kisi mobile credential link via email + SMS
 */
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/notify";
import { sendQuoSms } from "@/lib/quo";
import { kisiCreateUser, kisiSendCredentialLink, kisiAddUserToGroup } from "@/lib/kisi";
import { adminNotify } from "@/lib/admin-notify";
import { emitMemberEvent } from "@/lib/events";
import { isSquareConfigured } from "@/lib/square";
import { chargeInvoiceWithSource, createInvoice } from "@/services/billing.service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { locationSlug, planId, firstName, lastName, email, phone, waiverAccepted, sourceId, verificationToken } = body;
    if (!locationSlug || !planId || !firstName || !lastName || !email || !phone) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!waiverAccepted) {
      return NextResponse.json({ error: "Waiver must be accepted" }, { status: 400 });
    }

    const prisma = getPrisma();
    const location = await prisma.location.findUnique({ where: { slug: locationSlug } });
    if (!location) return NextResponse.json({ error: "Location not found" }, { status: 404 });

    const plan = await prisma.membershipPlan.findUnique({ where: { id: planId } });
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    if (plan.productType !== "DAY_PASS" || plan.category !== "VISITOR") {
      return NextResponse.json({ error: "Plan is not a day pass" }, { status: 400 });
    }
    const override = await prisma.membershipPricingOverride.findUnique({ where: { planId_locationId: { planId: plan.id, locationId: location.id } } });
    const priceCents = override?.priceCents ?? plan.priceCents;
    const normalizedEmail = String(email).trim().toLowerCase();

    // ---- Payment (only when Square is configured) ----------------------------
    const squareReady = isSquareConfigured();
    let invoiceId: string | null = null;
    let memberId: string | null = null;
    if (squareReady && priceCents > 0) {
      if (!sourceId) return NextResponse.json({ error: "Card details are required" }, { status: 400 });

      // Lightweight VISITOR member so the invoice/charge show up in Billing.
      const member =
        (await prisma.member.findUnique({ where: { locationId_email: { locationId: location.id, email: normalizedEmail } } })) ??
        (await prisma.member.create({
          data: {
            organizationId: location.organizationId,
            locationId: location.id,
            homeLocationId: location.id,
            firstName: String(firstName).trim(),
            lastName: String(lastName).trim(),
            fullName: `${firstName} ${lastName}`.trim(),
            email: normalizedEmail,
            phone: String(phone).trim(),
            status: "VISITOR",
            source: "day_pass",
            membershipType: plan.name,
            optInEmailMarketing: true,
            optInSmsMarketing: false,
          },
        }));
      memberId = member.id;

      const invoice = await createInvoice({
        organizationId: location.organizationId,
        locationId: location.id,
        memberId: member.id,
        description: `Day pass — ${plan.name}`,
        dueDate: new Date(),
        scheduledFor: new Date(),
        taxRateBps: location.taxRateBps,
        surchargeBps: location.cardSurchargeBps,
        applySurcharge: location.cardSurchargeBps > 0,
        lines: [{ description: plan.name, unitCents: priceCents }],
      });
      invoiceId = invoice.id;
      try {
        const r = await chargeInvoiceWithSource({ invoiceId: invoice.id, sourceId: String(sourceId), verificationToken: verificationToken ?? null, buyerEmail: normalizedEmail, note: `Day pass — ${plan.name}` });
        if (!r.succeeded) throw new Error("Payment was not approved");
      } catch (e: unknown) {
        return NextResponse.json({ error: e instanceof Error ? e.message : "Payment failed", invoiceId: invoice.id }, { status: 402 });
      }
    }

    // ---- Visitor record ------------------------------------------------------
    const visitor = await prisma.visitor.create({
      data: {
        organizationId: location.organizationId,
        locationId: location.id,
        stage: "CONVERTED",
        source: "day_pass",
        firstName,
        lastName,
        email: normalizedEmail,
        phone,
        events: { create: { kind: "DAY_PASS_PURCHASED", data: { planId: plan.id, invoiceId, priceCents, paidOnline: squareReady && priceCents > 0 } } },
      },
    });
    await emitMemberEvent("lead.created", {
      visitorId: visitor.id,
      memberId,
      locationId: location.id,
      organizationId: location.organizationId,
      refs: { invoiceId: invoiceId ?? undefined },
      vars: { source: "day_pass", planName: plan.name, amount: (priceCents / 100).toFixed(2), firstName, email: normalizedEmail, phone },
    });

    // Kisi credential — best effort
    let credentialLink: string | null = null;
    try {
      const kisiUser = await kisiCreateUser({
        email,
        name: `${firstName} ${lastName}`,
        phone,
      });

      const groups = (plan.kisiDoorGroups as Record<string, number[]> | null) ?? null;
      if (groups && groups[location.id]) {
        for (const groupId of groups[location.id]) {
          await kisiAddUserToGroup({ userId: kisiUser.id, groupId }).catch((e) =>
            console.warn("[daypass] add to group failed", e)
          );
        }
      }
      const link = await kisiSendCredentialLink(kisiUser.id);
      credentialLink = link.url ?? null;
    } catch (err: unknown) {
      console.error("[daypass] Kisi provisioning failed", err);
      void adminNotify({
        organizationId: location.organizationId,
        locationId: location.id,
        kind: "integration.alert",
        severity: "ERROR",
        title: "Day-pass Kisi provisioning failed",
        body: `${firstName} ${lastName} (${email}) — ${err instanceof Error ? err.message : String(err)}`,
        link: `/admin/locations/${location.slug}/marketing/visitors`,
        data: { visitorId: visitor.id },
      });
    }

    // Notify visitor
    const html = `
<div style="font-family:-apple-system,Helvetica,sans-serif;padding:24px;color:#0f172a;max-width:560px;margin:auto">
  <h1 style="margin:0 0 12px;font-size:20px;">Welcome, ${escapeHtml(firstName)}!</h1>
  <p style="margin:0 0 12px;color:#475569;">Your day pass for ${escapeHtml(location.name)} is active.</p>
  ${credentialLink
    ? `<p style="margin:0 0 12px;">Tap to add your door key:</p><a href="${credentialLink}" style="display:inline-block;background:#16a34a;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:600;">Get door access</a>`
    : `<p style="margin:0 0 12px;color:#94a3b8;">Door credential will be emailed shortly.</p>`}
  <p style="margin-top:16px;font-size:12px;color:#94a3b8;">Pass valid for the next 24 hours.</p>
</div>`;
    sendEmail({ to: email, subject: `Your ${location.name} day pass`, html }).catch(() => {});
    if (credentialLink) {
      sendQuoSms({
        to: phone,
        text: `Welcome to ${location.name}! Your door access: ${credentialLink}`,
      }).catch(() => {});
    }

    void audit({
      organizationId: location.organizationId,
      action: "membership.create",
      entityType: "Visitor",
      entityId: visitor.id,
      after: { dayPass: true, planId: plan.id, locationId: location.id, invoiceId },
      metadata: { credentialIssued: !!credentialLink, paidOnline: squareReady && priceCents > 0 },
    });

    return NextResponse.json({ ok: true, visitorId: visitor.id, invoiceId });
  } catch (e: unknown) {
    console.error("[daypass] error", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Server error" }, { status: 500 });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
