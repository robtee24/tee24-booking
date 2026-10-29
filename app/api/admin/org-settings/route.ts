// /api/admin/org-settings — organization defaults + email/SMS controls.
//   GET    → { org }                      ROOT/FULL
//   PATCH  → { org }  (partial update)    ROOT/FULL + `admin.configure-integrations`
//
// v1 has a single Organization row; if none exists we create one lazily so the
// settings page always has something to edit.
import { NextResponse, type NextRequest } from "next/server";
import { requireFullAdminApi } from "@/lib/api-auth";
import { getActorContext } from "@/lib/actor";
import { assertCan, ForbiddenError } from "@/lib/permissions";
import { getPrisma } from "@/lib/db";
import { audit, diff } from "@/lib/audit";
import { getOrCreateOrg, invalidateCommsStatus, isValidTimezone, ORG_SETTINGS_SELECT as SELECT } from "@/services/location.service";
import { invalidateCommsSettingsCache } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireFullAdminApi();
  if (!guard.ok) return guard.response;
  const org = await getOrCreateOrg();
  return NextResponse.json({ ok: true, org });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function optionalEmail(v: unknown, label: string): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (!EMAIL_RE.test(s)) throw new Error(`${label} is not a valid email address`);
  return s;
}

export async function PATCH(req: NextRequest) {
  const guard = await requireFullAdminApi();
  if (!guard.ok) return guard.response;
  try {
    assertCan(await getActorContext(), "admin.configure-integrations");
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const before = await getOrCreateOrg();

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const n = String(body.name ?? "").trim();
      if (!n) throw new Error("Organization name cannot be empty");
      data.name = n.slice(0, 120);
    }
    if (body.brandColor !== undefined) {
      const c = String(body.brandColor ?? "").trim();
      if (c && !/^#[0-9a-fA-F]{6}$/.test(c)) throw new Error("Brand color must be a hex value like #0071e3");
      data.brandColor = c || null;
    }
    if (body.logoUrl !== undefined) {
      const u = String(body.logoUrl ?? "").trim();
      if (u && !/^https?:\/\//i.test(u)) throw new Error("Logo URL must start with http:// or https://");
      data.logoUrl = u || null;
    }
    if (body.contactEmail !== undefined) data.contactEmail = optionalEmail(body.contactEmail, "Contact email");
    if (body.contactPhone !== undefined) data.contactPhone = String(body.contactPhone ?? "").trim() || null;
    if (body.defaultTimezone !== undefined) {
      const tz = String(body.defaultTimezone ?? "").trim();
      if (!isValidTimezone(tz)) throw new Error(`Unknown timezone "${tz}"`);
      data.defaultTimezone = tz;
    }
    if (body.emailEnabled !== undefined) data.emailEnabled = Boolean(body.emailEnabled);
    if (body.smsEnabled !== undefined) data.smsEnabled = Boolean(body.smsEnabled);
    if (body.pushEnabled !== undefined) data.pushEnabled = Boolean(body.pushEnabled);
    if (body.bccEmail !== undefined) data.bccEmail = optionalEmail(body.bccEmail, "BCC email");
    if (body.replyToEmail !== undefined) data.replyToEmail = optionalEmail(body.replyToEmail, "Reply-to email");
    if (body.emailFooter !== undefined) data.emailFooter = String(body.emailFooter ?? "").trim().slice(0, 4000) || null;

    const org = await getPrisma().organization.update({ where: { id: before.id }, data, select: SELECT });
    invalidateCommsStatus();
    invalidateCommsSettingsCache();

    const d = diff(before as Record<string, unknown>, org as Record<string, unknown>);
    void audit({
      organizationId: org.id,
      actorId: guard.admin.id,
      actorRole: guard.admin.role,
      action: "settings.update",
      entityType: "Organization",
      entityId: org.id,
      before: d.before,
      after: d.after,
      metadata: { via: "org-settings" },
    });

    return NextResponse.json({ ok: true, org });
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    const message = err instanceof Error ? err.message : "Server error";
    const known = /cannot be empty|not a valid|must|Unknown timezone/.test(message);
    if (!known) console.error("[org-settings] PATCH", err);
    return NextResponse.json({ ok: false, error: message }, { status: known ? 400 : 500 });
  }
}
