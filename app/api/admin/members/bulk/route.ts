import { NextRequest, NextResponse } from "next/server";
import { requireLocationApi } from "@/app/api/admin/members/_shared";
import { getPrisma } from "@/lib/db";
import { getActorContext } from "@/lib/actor";
import { assertCan } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { emitMemberEvent } from "@/lib/events";
import { addMemberTag, removeMemberTag } from "@/services/member.service";
import { cancelSubscription, freezeSubscription } from "@/services/membership.service";
import { apiError, parseDate, readJson } from "../_shared";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/members/bulk
 * { locationSlug, memberIds: string[], action: "addTag" | "removeTag" | "freeze" | "cancel", tagId?, tagName?, resumeDate?, reason?, immediate? }
 * Permission member.bulk-action (+ membership.freeze / membership.cancel for those actions).
 */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const { locationSlug } = body;
  if (!locationSlug) return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
  const guard = await requireLocationApi({ locationSlug });
  if (!guard.ok) return guard.response;
  const actor = await getActorContext();
  try {
    assertCan(actor, "member.bulk-action", { locationId: guard.location.id });
    const memberIds: string[] = Array.isArray(body.memberIds) ? body.memberIds.map(String) : [];
    if (memberIds.length === 0) return NextResponse.json({ error: "memberIds required" }, { status: 400 });
    if (memberIds.length > 500) return NextResponse.json({ error: "Max 500 members per bulk action" }, { status: 400 });
    const prisma = getPrisma();
    const members = await prisma.member.findMany({ where: { id: { in: memberIds }, locationId: guard.location.id }, select: { id: true, organizationId: true } });
    const ids = members.map((m) => m.id);
    const orgId = members[0]?.organizationId ?? null;
    const errors: Array<{ memberId: string; error: string }> = [];
    let affected = 0;

    switch (body.action) {
      case "addTag":
      case "removeTag": {
        let tagId = body.tagId ? String(body.tagId) : null;
        if (!tagId && body.tagName && body.action === "addTag") {
          const name = String(body.tagName).trim();
          const existing = await prisma.tag.findFirst({ where: { organizationId: orgId, name: { equals: name, mode: "insensitive" } } });
          tagId = (existing ?? (await prisma.tag.create({ data: { organizationId: orgId, name, color: "#16a34a" } }))).id;
        }
        if (!tagId) return NextResponse.json({ error: "tagId required" }, { status: 400 });
        for (const id of ids) {
          try {
            if (body.action === "addTag") await addMemberTag(id, tagId, guard.admin.id);
            else await removeMemberTag(id, tagId, guard.admin.id);
            affected++;
          } catch (e) {
            errors.push({ memberId: id, error: e instanceof Error ? e.message : "failed" });
          }
        }
        break;
      }
      case "freeze": {
        assertCan(actor, "membership.freeze", { locationId: guard.location.id });
        assertCan(actor, "membership.freeze-immediate", { locationId: guard.location.id });
        const resumeDate = parseDate(body.resumeDate);
        if (!resumeDate) return NextResponse.json({ error: "resumeDate required" }, { status: 400 });
        const subs = await prisma.membershipSubscription.findMany({ where: { memberId: { in: ids }, status: { in: ["ACTIVE", "CANCEL_SCHEDULED"] } }, select: { id: true, memberId: true, plan: { select: { name: true } } } });
        for (const s of subs) {
          try {
            await freezeSubscription({ subscriptionId: s.id, immediate: true, resumeDate, reason: String(body.reason ?? "Bulk freeze"), feeCents: 0 }, guard.admin.id);
            await prisma.member.update({ where: { id: s.memberId }, data: { status: "FROZEN" } });
            void emitMemberEvent("membership.frozen", { memberId: s.memberId, locationId: guard.location.id, organizationId: orgId, actorAdminId: guard.admin.id, refs: { subscriptionId: s.id }, vars: { planName: s.plan.name, resumeDate: resumeDate.toISOString(), bulk: "yes" } });
            affected++;
          } catch (e) {
            errors.push({ memberId: s.memberId, error: e instanceof Error ? e.message : "failed" });
          }
        }
        break;
      }
      case "cancel": {
        assertCan(actor, "membership.cancel", { locationId: guard.location.id });
        const immediate = !!body.immediate;
        if (immediate) assertCan(actor, "membership.cancel-immediate", { locationId: guard.location.id });
        const subs = await prisma.membershipSubscription.findMany({ where: { memberId: { in: ids }, status: { in: ["ACTIVE", "FROZEN", "FREEZE_SCHEDULED", "COMP", "PENDING"] } }, select: { id: true, memberId: true, plan: { select: { name: true } } } });
        for (const s of subs) {
          try {
            await cancelSubscription({ subscriptionId: s.id, immediate, reason: String(body.reason ?? "Bulk cancellation") }, guard.admin.id);
            if (immediate) await prisma.member.update({ where: { id: s.memberId }, data: { status: "CANCELLED" } });
            void emitMemberEvent(immediate ? "membership.cancelled" : "membership.cancel-scheduled", { memberId: s.memberId, locationId: guard.location.id, organizationId: orgId, actorAdminId: guard.admin.id, refs: { subscriptionId: s.id }, vars: { planName: s.plan.name, bulk: "yes" } });
            affected++;
          } catch (e) {
            errors.push({ memberId: s.memberId, error: e instanceof Error ? e.message : "failed" });
          }
        }
        break;
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    void audit({ organizationId: orgId, actorId: guard.admin.id, actorRole: guard.admin.role, action: "member.update", entityType: "Location", entityId: guard.location.id, metadata: { event: "member.bulk-action", bulkAction: body.action, count: ids.length, affected, errors: errors.length } });
    return NextResponse.json({ ok: true, affected, requested: ids.length, errors });
  } catch (e) {
    return apiError(e);
  }
}
