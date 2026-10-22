// POST /api/admin/admins/[id]/invite — (re)send the staff invite SMS/email.
// Requires `admin.manage`.
import { NextResponse } from "next/server";
import { requireFullAdminApi } from "@/lib/api-auth";
import { getActorContext } from "@/lib/actor";
import { assertCan } from "@/lib/permissions";
import { sendStaffInvite } from "@/services/staff.service";
import { paramId, staffApiError } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireFullAdminApi();
  if (!guard.ok) return guard.response;
  try {
    assertCan(await getActorContext(), "admin.manage");
    const id = await paramId(ctx);
    const result = await sendStaffInvite(id, guard.admin.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return staffApiError(err);
  }
}
