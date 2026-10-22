// /api/admin/auth/pin — the signed-in admin's own front-desk PIN.
//   POST { pin }  → set / reset (4–6 digits)
//   DELETE        → remove
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { clearAdminPin, setAdminPin, StaffError } from "@/services/staff.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  try {
    const body = await req.json().catch(() => ({} as { pin?: string }));
    await setAdminPin(guard.admin.id, String(body.pin ?? ""), guard.admin.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof StaffError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    console.error("[auth/pin] POST", err);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}

export async function DELETE() {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  await clearAdminPin(guard.admin.id, guard.admin.id);
  return NextResponse.json({ ok: true });
}
