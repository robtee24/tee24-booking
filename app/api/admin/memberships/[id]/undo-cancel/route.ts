import { NextRequest, NextResponse } from "next/server";
import { assertCan } from "@/lib/permissions";
import { emitMemberEvent } from "@/lib/events";
import { undoCancellation } from "@/services/membership.service";
import { apiError } from "@/app/api/admin/members/_shared";
import { requireSubscriptionApi } from "../_guard";

export const dynamic = "force-dynamic";

/** POST /api/admin/memberships/[id]/undo-cancel — permission membership.cancel */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireSubscriptionApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "membership.cancel", { locationId: g.sub.locationId });
    const result = await undoCancellation(id, g.admin.id);
    void emitMemberEvent("membership.renewed", {
      memberId: g.sub.memberId,
      locationId: g.sub.locationId,
      organizationId: g.sub.organizationId,
      actorAdminId: g.admin.id,
      refs: { subscriptionId: id },
      vars: { planName: g.sub.planName, undoCancel: "yes" },
    });
    return NextResponse.json({ ok: true, subscription: result });
  } catch (e) {
    return apiError(e);
  }
}
