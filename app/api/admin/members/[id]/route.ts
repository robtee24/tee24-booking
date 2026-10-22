import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { getMemberDetail, updateMember, setCustomFieldValues, type UpdateMemberInput } from "@/services/member.service";
import { apiError, parseDate, readJson, requireMemberApi } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  const member = await getMemberDetail(id);
  if (!member) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ member });
}

const STRING_FIELDS = [
  "firstName", "lastName", "email", "phone", "gender", "homeLocationId", "addressLine1", "addressLine2", "city", "state", "zip", "country",
  "photoUrl", "guardianName", "acquisitionSource", "membershipType",
] as const;
const BOOL_FIELDS = ["optInEmailMarketing", "optInSmsMarketing", "smsConsent"] as const;

/** PATCH /api/admin/members/[id] — permission member.edit. Accepts profile fields + customFields map. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "member.edit", { locationId: g.member.locationId });
    const body = await readJson(req);
    const patch: UpdateMemberInput = {};
    for (const k of STRING_FIELDS) {
      if (k in body) (patch as Record<string, unknown>)[k] = body[k] == null || body[k] === "" ? (k === "firstName" || k === "lastName" || k === "email" || k === "phone" ? undefined : null) : String(body[k]);
    }
    for (const k of BOOL_FIELDS) if (k in body) (patch as Record<string, unknown>)[k] = Boolean(body[k]);
    if ("dob" in body) patch.dob = parseDate(body.dob) ?? null;
    if ("joinDate" in body) patch.joinDate = parseDate(body.joinDate) ?? null;
    if ("status" in body && body.status) {
      assertCan(g.actor, "member.edit", { locationId: g.member.locationId });
      patch.status = body.status;
    }
    if (Array.isArray(body.secondaryEmails)) patch.secondaryEmails = body.secondaryEmails.map(String);
    if (Array.isArray(body.secondaryPhones)) patch.secondaryPhones = body.secondaryPhones.map(String);

    if (patch.email) {
      const dupe = await getPrisma().member.findFirst({ where: { locationId: g.member.locationId, email: patch.email.trim().toLowerCase(), NOT: { id } }, select: { id: true } });
      if (dupe) return NextResponse.json({ error: "Another member at this location already uses that email" }, { status: 409 });
    }

    const updated = await updateMember(id, patch, g.admin.id);
    if (body.customFields && typeof body.customFields === "object") {
      await setCustomFieldValues(id, body.customFields, g.admin.id);
    }
    return NextResponse.json({ member: updated });
  } catch (e) {
    return apiError(e);
  }
}

/** DELETE /api/admin/members/[id] — permission member.delete */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "member.delete", { locationId: g.member.locationId });
    // Visit.member is onDelete:SetNull; hard-deleting a member should not leave
    // anonymous "Guest" visits behind in attendance / front-desk recent lists.
    const prisma = getPrisma();
    await prisma.$transaction([
      prisma.visit.deleteMany({ where: { memberId: id } }),
      prisma.member.delete({ where: { id } }),
    ]);
    void audit({ organizationId: g.member.organizationId, actorId: g.admin.id, actorRole: g.admin.role, action: "member.delete", entityType: "Member", entityId: id, before: g.member });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
