import { NextRequest, NextResponse } from "next/server";
import { requireLocationApi } from "@/app/api/admin/members/_shared";
import { getPrisma } from "@/lib/db";
import { getActorContext } from "@/lib/actor";
import { assertCan } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { sendEmail, sendSMS } from "@/lib/notify";
import { apiError, readJson } from "../_shared";
import { memberBaseUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";

function baseUrl(_req: NextRequest) {
  return memberBaseUrl();
}

/** GET /api/admin/members/invite?locationSlug= — active signup forms (slugs) usable in invites */
export async function GET(req: NextRequest) {
  const locationSlug = req.nextUrl.searchParams.get("locationSlug");
  if (!locationSlug) return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
  const guard = await requireLocationApi({ locationSlug });
  if (!guard.ok) return guard.response;
  const loc = await getPrisma().location.findUnique({ where: { id: guard.location.id }, select: { organizationId: true } });
  const forms = await getPrisma().signupForm.findMany({
    where: { active: true, OR: [{ locationId: guard.location.id }, { locationId: null, organizationId: loc?.organizationId ?? null }] },
    orderBy: { name: "asc" },
    select: { id: true, slug: true, name: true, description: true },
  });
  return NextResponse.json({ forms: forms.map((f) => ({ ...f, url: `${baseUrl(req)}/signup/${f.slug}` })) });
}

/**
 * POST /api/admin/members/invite
 * { locationSlug, channel: "EMAIL" | "SMS", to, name?, formSlug, message? }
 * Permission member.edit. Sends `${MEMBER_BASE_URL}/signup/<formSlug>?ref=invite`.
 */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const { locationSlug } = body;
  if (!locationSlug) return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
  const guard = await requireLocationApi({ locationSlug });
  if (!guard.ok) return guard.response;
  const actor = await getActorContext();
  try {
    assertCan(actor, "member.edit", { locationId: guard.location.id });
    const channel = body.channel === "SMS" ? "SMS" : "EMAIL";
    const to = String(body.to ?? "").trim();
    const formSlug = String(body.formSlug ?? "").trim();
    if (!to) return NextResponse.json({ error: "Recipient is required" }, { status: 400 });
    if (!formSlug) return NextResponse.json({ error: "Choose a signup form" }, { status: 400 });
    const form = await getPrisma().signupForm.findUnique({ where: { slug: formSlug }, select: { id: true, name: true, active: true } });
    if (!form || !form.active) return NextResponse.json({ error: "Signup form not found or inactive" }, { status: 404 });

    const ref = `invite-${guard.admin.id.slice(0, 8)}`;
    const link = `${baseUrl(req)}/signup/${encodeURIComponent(formSlug)}?ref=${encodeURIComponent(ref)}`;
    const name = String(body.name ?? "").trim();
    const custom = String(body.message ?? "").trim();
    const greeting = name ? `Hi ${name},` : "Hi,";
    const intro = custom || `You're invited to join ${guard.location.name}. Use the link below to sign up.`;

    if (channel === "SMS") {
      await sendSMS({ to, text: `${greeting} ${intro} ${link}`, ledger: { locationId: guard.location.id, source: "member.invite" } });
    } else {
      await sendEmail({
        to,
        subject: `You're invited to join ${guard.location.name}`,
        ledger: { locationId: guard.location.id, source: "member.invite" },
        html: `<div style="font-family:-apple-system,BlinkMacSystemFont,Helvetica,sans-serif;padding:24px;color:#0f172a;max-width:560px;margin:auto;"><p style="margin:0 0 16px;">${escapeHtml(greeting)}</p><p style="margin:0 0 16px;color:#475569;white-space:pre-wrap;">${escapeHtml(intro)}</p><a href="${link}" style="display:inline-block;background:#16a34a;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:600;">Sign up</a><p style="margin-top:16px;font-size:12px;color:#94a3b8;">Link: ${link}</p></div>`,
      });
    }

    // Track as a lead in the visitors funnel
    const loc = await getPrisma().location.findUnique({ where: { id: guard.location.id }, select: { organizationId: true } });
    const [firstName, ...rest] = name.split(/\s+/).filter(Boolean);
    await getPrisma().visitor.create({
      data: {
        organizationId: loc?.organizationId ?? null,
        locationId: guard.location.id,
        stage: "ENGAGED",
        source: "INVITE",
        firstName: firstName ?? null,
        lastName: rest.join(" ") || null,
        email: channel === "EMAIL" ? to.toLowerCase() : null,
        phone: channel === "SMS" ? to : null,
        lastContactedAt: new Date(),
        notes: `Invited via ${channel.toLowerCase()} to ${form.name}`,
        events: { create: { kind: "INVITED", data: { channel, formSlug, link, adminId: guard.admin.id } } },
      },
    }).catch(() => undefined);

    void audit({ organizationId: loc?.organizationId ?? null, actorId: guard.admin.id, actorRole: guard.admin.role, action: "message.send", entityType: "SignupForm", entityId: form.id, metadata: { event: "member.invite", channel, to, formSlug } });
    return NextResponse.json({ ok: true, link });
  } catch (e) {
    return apiError(e);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
