// /api/admin/admins/[id]/pin — manage another admin's front-desk PIN.
//   POST   { pin }  → set / reset (4–6 digits). Requires `admin.manage`.
//   DELETE          → clear the PIN.
import { NextResponse } from "next/server";
import { requireFullAdminApi } from "@/lib/api-auth";
import { getActorContext } from "@/lib/actor";
import { assertCan } from "@/lib/permissions";
import { clearAdminPin, setAdminPin } from "@/services/staff.service";
import { paramId, staffApiError } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const guard = await requireFullAdminApi();
  if (!guard.ok) return guard.response;
  try {
    assertCan(await getActorContext(), "admin.manage");
    const id = await paramId(ctx);
    const body = await req.json().catch(() => ({} as { pin?: string }));
    await setAdminPin(id, String(body.pin ?? ""), guard.admin.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return staffApiError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const guard = await requireFullAdminApi();
  if (!guard.ok) return guard.response;
  try {
    assertCan(await getActorContext(), "admin.manage");
    const id = await paramId(ctx);
    await clearAdminPin(id, guard.admin.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return staffApiError(err);
  }
}
