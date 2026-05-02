/**
 * Day-pass guest checkout endpoint.
 *
 * - No account creation
 * - Captures Visitor record
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

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { locationSlug, planId, firstName, lastName, email, phone, waiverAccepted } = body;
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

    // Visitor record
    const visitor = await prisma.visitor.create({
      data: {
        organizationId: location.organizationId,
        locationId: location.id,
        stage: "CONVERTED",
        source: "day_pass",
        firstName,
        lastName,
        email: String(email).trim().toLowerCase(),
        phone,
      },
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
    } catch (err: any) {
      console.error("[daypass] Kisi provisioning failed", err);
      void adminNotify({
        organizationId: location.organizationId,
        locationId: location.id,
        kind: "integration.alert",
        severity: "ERROR",
        title: "Day-pass Kisi provisioning failed",
        body: `${firstName} ${lastName} (${email}) — ${err.message}`,
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
      after: { dayPass: true, planId: plan.id, locationId: location.id },
      metadata: { credentialIssued: !!credentialLink },
    });

    return NextResponse.json({ ok: true, visitorId: visitor.id });
  } catch (e: any) {
    console.error("[daypass] error", e);
    return NextResponse.json({ error: e.message ?? "Server error" }, { status: 500 });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
