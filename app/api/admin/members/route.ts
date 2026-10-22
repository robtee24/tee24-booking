import { NextRequest, NextResponse } from "next/server";
import { requireLocationApi } from "@/app/api/admin/members/_shared";
import { getPrisma } from "@/lib/db";
import { getActorContext } from "@/lib/actor";
import { assertCan } from "@/lib/permissions";
import { emitMemberEvent } from "@/lib/events";
import {
  queryMembers,
  countMembersByStatus,
  createMember,
  addMemberTag,
  addMemberNote,
  setCustomFieldValues,
  type MemberStatus,
} from "@/services/member.service";
import { subscribeMember } from "@/services/membership.service";
import { assignDocument } from "@/services/document.service";
import { apiError, memberQueryFromParams, parseDate, readJson } from "./_shared";
import { sendAccessLink } from "./[id]/access-link/send";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const locationSlug = sp.get("locationSlug");
  if (!locationSlug) return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
  const guard = await requireLocationApi({ locationSlug });
  if (!guard.ok) return guard.response;

  try {
    const q = memberQueryFromParams(sp, guard.location.id);
    const [result, counts] = await Promise.all([queryMembers(q), countMembersByStatus(q)]);
    return NextResponse.json({
      items: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      counts,
      // Back-compat for older callers
      members: result.items,
      nextCursor: null,
    });
  } catch (e) {
    console.error("[Members list] Error:", e);
    return apiError(e, 500);
  }
}

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const { locationSlug } = body;
  if (!locationSlug) return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
  const guard = await requireLocationApi({ locationSlug });
  if (!guard.ok) return guard.response;
  const actor = await getActorContext();

  try {
    assertCan(actor, "member.edit", { locationId: guard.location.id });
    const location = await getPrisma().location.findUnique({ where: { id: guard.location.id }, select: { id: true, organizationId: true } });
    if (!location) return NextResponse.json({ error: "Location not found" }, { status: 404 });

    const firstName = String(body.firstName ?? "").trim();
    const lastName = String(body.lastName ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const phone = String(body.phone ?? "").trim();
    if (!firstName || !lastName || !email || !phone) {
      return NextResponse.json({ error: "firstName, lastName, email and phone are required" }, { status: 400 });
    }

    const dupe = await getPrisma().member.findUnique({ where: { locationId_email: { locationId: location.id, email } }, select: { id: true } });
    if (dupe) return NextResponse.json({ error: "A member with this email already exists at this location", memberId: dupe.id }, { status: 409 });

    const type = body.type === "visitor" ? "VISITOR" : "member";
    const planId = body.planId ? String(body.planId) : null;
    const status: MemberStatus = type === "VISITOR" ? "VISITOR" : (body.status as MemberStatus) || (planId ? "ACTIVE" : "PENDING");

    const member = await createMember({
      locationId: location.id,
      organizationId: location.organizationId,
      firstName,
      lastName,
      email,
      phone,
      dob: parseDate(body.dob) ?? null,
      gender: body.gender || null,
      status,
      membershipType: body.membershipType || null,
      joinDate: parseDate(body.joinDate) ?? new Date(),
      optInEmailMarketing: body.optInEmailMarketing ?? true,
      optInSmsMarketing: body.optInSmsMarketing ?? false,
      smsConsent: body.smsConsent ?? body.optInSmsMarketing ?? false,
      smsConsentSource: body.smsConsent ? "admin_create" : null,
      secondaryEmails: Array.isArray(body.secondaryEmails) ? body.secondaryEmails.map(String) : body.secondaryEmail ? [String(body.secondaryEmail)] : [],
      secondaryPhones: Array.isArray(body.secondaryPhones) ? body.secondaryPhones.map(String) : body.secondaryPhone ? [String(body.secondaryPhone)] : [],
      guardianName: body.guardianName || null,
      acquisitionSource: body.acquisitionSource || null,
      photoUrl: body.photoUrl || null,
      addressLine1: body.addressLine1 || null,
      addressLine2: body.addressLine2 || null,
      city: body.city || null,
      state: body.state || null,
      zip: body.zip || null,
      country: body.country || "US",
      source: "ADMIN",
      actorId: guard.admin.id,
    });

    const warnings: string[] = [];

    // Tags
    if (Array.isArray(body.tagIds)) {
      for (const tagId of body.tagIds) await addMemberTag(member.id, String(tagId), guard.admin.id).catch(() => warnings.push(`Tag ${tagId} not applied`));
    }
    // Custom fields
    if (body.customFields && typeof body.customFields === "object") {
      await setCustomFieldValues(member.id, body.customFields, guard.admin.id).catch((e) => warnings.push(`Custom fields: ${e.message}`));
    }

    // Plan at creation
    let subscription: { id: string; priceCents: number; planName: string } | null = null;
    if (planId) {
      try {
        assertCan(actor, "membership.subscribe", { locationId: location.id });
        const created = await subscribeMember(
          { memberId: member.id, planId, locationId: location.id, startDate: parseDate(body.planStartDate) ?? new Date(), comp: !!body.comp },
          guard.admin.id,
        );
        let priceCents = created.priceCents;
        if (body.priceOverrideCents != null && Number.isFinite(Number(body.priceOverrideCents))) {
          priceCents = Math.max(0, Math.round(Number(body.priceOverrideCents)));
          await getPrisma().membershipSubscription.update({ where: { id: created.id }, data: { priceCents } });
        }
        subscription = { id: created.id, priceCents, planName: created.plan?.name ?? "" };
        void emitMemberEvent("membership.activated", {
          memberId: member.id,
          locationId: location.id,
          organizationId: location.organizationId,
          actorAdminId: guard.admin.id,
          refs: { subscriptionId: subscription.id },
          vars: { planName: subscription.planName, priceCents: subscription.priceCents },
        });
      } catch (e) {
        warnings.push(`Plan not added: ${e instanceof Error ? e.message : "error"}`);
      }
    }

    // Discount code — billing module owns application; keep a note for now.
    if (body.discountCode) {
      await addMemberNote(member.id, `Discount code requested at signup: ${String(body.discountCode).trim()}`, { authorId: guard.admin.id }).catch(() => undefined);
    }

    // Required documents
    const requiredDocs = await getPrisma().document.findMany({
      where: { active: true, requiredAtSignup: true, OR: [{ organizationId: location.organizationId }, { organizationId: null }] },
      select: { id: true, name: true },
    });
    const sendSigning = body.sendSigningLink !== false;
    const assigned: string[] = [];
    if (body.assignRequiredDocuments !== false) {
      for (const d of requiredDocs) {
        try {
          const a = await assignDocument({ documentId: d.id, memberId: member.id, notify: { email: sendSigning, sms: sendSigning && !!body.smsConsent }, actorId: guard.admin.id });
          assigned.push(d.name);
          void emitMemberEvent("document.assigned", { memberId: member.id, locationId: location.id, organizationId: location.organizationId, actorAdminId: guard.admin.id, refs: { assignmentId: a.id }, vars: { documentName: d.name } });
        } catch (e) {
          warnings.push(`Document "${d.name}" not assigned: ${e instanceof Error ? e.message : "error"}`);
        }
      }
    }

    void emitMemberEvent("member.created", {
      memberId: member.id,
      locationId: location.id,
      organizationId: location.organizationId,
      actorAdminId: guard.admin.id,
      vars: { firstName, lastName, email, status, source: "ADMIN" },
    });

    // Portal access link
    if (body.sendAccessLink) {
      try {
        await sendAccessLink(member.id, req);
        void emitMemberEvent("member.welcome", { memberId: member.id, locationId: location.id, organizationId: location.organizationId, actorAdminId: guard.admin.id });
      } catch (e) {
        warnings.push(`Access link not sent: ${e instanceof Error ? e.message : "error"}`);
      }
    }

    return NextResponse.json({ member, subscription, assignedDocuments: assigned, warnings });
  } catch (e) {
    console.error("[Members create] Error:", e);
    return apiError(e);
  }
}
