import { NextRequest, NextResponse } from "next/server";
import { assertCan } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { emitMemberEvent } from "@/lib/events";
import { apiError, readJson, requireMemberApi } from "../../_shared";
import { sendAccessLink } from "./send";

export const dynamic = "force-dynamic";

/** POST /api/admin/members/[id]/access-link  { channel?: "EMAIL" | "SMS" } — permission member.edit */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "member.edit", { locationId: g.member.locationId });
    const body = await readJson(req);
    const channel = body.channel === "SMS" ? "SMS" : "EMAIL";
    await sendAccessLink(id, req, { channel });
    void audit({ organizationId: g.member.organizationId, actorId: g.admin.id, actorRole: g.admin.role, action: "message.send", entityType: "Member", entityId: id, metadata: { kind: "access-link", channel } });
    void emitMemberEvent("member.welcome", { memberId: id, locationId: g.member.locationId, organizationId: g.member.organizationId, actorAdminId: g.admin.id, vars: { channel } });
    return NextResponse.json({ ok: true, channel });
  } catch (e) {
    return apiError(e);
  }
}
