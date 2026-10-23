// /api/admin/mobile/transfer-requests — "new phone" requests from the member app.
//   GET   ?status=PENDING|APPROVED|DENIED|CANCELLED|all
//   PATCH { id, action: "approve" | "deny", note? }
// SCOPED admins only see requests from members at their locations.
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { isFullAccess } from "@/lib/access";
import { getPrisma } from "@/lib/db";
import { approveDeviceTransfer, denyDeviceTransfer, listTransferRequests, MobileError } from "@/services/mobile-auth.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(err: unknown) {
  if (err instanceof MobileError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
  console.error("[admin/mobile/transfer-requests]", err);
  return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Server error" }, { status: 500 });
}

export async function GET(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  const status = req.nextUrl.searchParams.get("status") ?? "PENDING";
  const locationIds = isFullAccess(guard.admin.role) ? undefined : guard.admin.locations.map((l) => l.locationId);
  const requests = await listTransferRequests({ status: status === "all" ? undefined : status, locationIds, limit: 200 });
  return NextResponse.json({ ok: true, requests });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as { id?: string; action?: string; note?: string };
    if (!body.id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
    if (!isFullAccess(guard.admin.role)) {
      const r = await getPrisma().deviceTransferRequest.findUnique({ where: { id: body.id }, select: { member: { select: { locationId: true } } } });
      if (!r || !guard.admin.locations.some((l) => l.locationId === r.member.locationId)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const note = body.note?.trim().slice(0, 500) || null;
    if (body.action === "approve") return NextResponse.json({ ok: true, request: await approveDeviceTransfer(body.id, guard.admin.id, note) });
    if (body.action === "deny") return NextResponse.json({ ok: true, request: await denyDeviceTransfer(body.id, guard.admin.id, note) });
    return NextResponse.json({ ok: false, error: "action must be approve or deny" }, { status: 400 });
  } catch (err) {
    return fail(err);
  }
}
