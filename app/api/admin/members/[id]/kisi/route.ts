import { NextRequest, NextResponse } from "next/server";
import { assertCan } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { applyAccessState, computeDesiredAccessState } from "@/lib/access-sync";
import { apiError, readJson, requireMemberApi } from "../../_shared";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/members/[id]/kisi { enabled: boolean, reason?: string } — manual door-access
 * override (permission kisi.override). { resync: true } recomputes from billing/membership state.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "kisi.override", { locationId: g.member.locationId });
    const body = await readJson(req);
    let result: { enabled: boolean; reason: string };
    if (body.resync) {
      const desired = await computeDesiredAccessState(id);
      result = await applyAccessState(id, desired);
    } else {
      const enabled = Boolean(body.enabled);
      const desired = await computeDesiredAccessState(id);
      result = await applyAccessState(id, { enabled, reason: "manual_override", desiredGroupIds: enabled ? desired.desiredGroupIds : [] });
      void audit({
        organizationId: g.member.organizationId,
        actorId: g.admin.id,
        actorRole: g.admin.role,
        action: "kisi.access-override",
        entityType: "Member",
        entityId: id,
        after: { kisiAccessEnabled: enabled },
        metadata: { reason: body.reason ?? null },
      });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return apiError(e);
  }
}
