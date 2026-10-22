// POST /api/admin/dashboard/dismiss
// Body: { locationSlug, alertKey?: string, alertKeys?: string[] }
// Records dismissals as AdminNotification rows (kind `alert.dismissed`).
// Any admin with access to the location (location membership is the gate;
// there is no finer-grained dashboard permission in the catalog).
import { NextResponse, type NextRequest } from "next/server";
import { requireLocationAdminApi } from "@/lib/api-auth";
import { dismissAlerts } from "@/services/dashboard.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const locationSlug = String(body.locationSlug ?? "").trim();
  if (!locationSlug) return NextResponse.json({ ok: false, error: "locationSlug required" }, { status: 400 });
  const guard = await requireLocationAdminApi({ locationSlug });
  if (!guard.ok) return guard.response;
  const location = guard.location!;
  try {
    const keys = [
      ...(typeof body.alertKey === "string" ? [body.alertKey] : []),
      ...(Array.isArray(body.alertKeys) ? body.alertKeys.map(String) : []),
    ];
    if (keys.length === 0) return NextResponse.json({ ok: false, error: "alertKey(s) required" }, { status: 400 });
    const dismissed = await dismissAlerts({
      locationId: location.id,
      alertKeys: keys,
      adminId: guard.admin.id,
    });
    return NextResponse.json({ ok: true, dismissed });
  } catch (err) {
    console.error("[dashboard/dismiss]", err);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
