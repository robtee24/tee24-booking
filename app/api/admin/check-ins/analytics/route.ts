/**
 * GET /api/admin/check-ins/analytics?days=30&locationId=&block=3&winStart=21&winEnd=23
 *
 * Location- and member-level usage analytics derived from Kisi check-ins.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi, forbidden } from "@/lib/api-auth";
import { canAccessLocation, isFullAccess } from "@/lib/access";
import { getCheckInAnalytics, BLOCK_OPTIONS, type BlockHours } from "@/services/checkin-analytics.service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const sp = req.nextUrl.searchParams;
  const locationId = sp.get("locationId") || undefined;
  const adminLocIds = admin.locations.map((l) => l.locationId);
  if (locationId && !canAccessLocation(admin.role, adminLocIds, locationId)) return forbidden();

  const days = Math.min(Math.max(Number(sp.get("days") ?? 30) || 30, 7), 365);
  const blockRaw = Number(sp.get("block") ?? 3);
  const blockHours = (BLOCK_OPTIONS.includes(blockRaw as BlockHours) ? blockRaw : 3) as BlockHours;

  const ws = sp.get("winStart");
  const we = sp.get("winEnd");
  let window: { start: number; end: number } | null = null;
  if (ws != null && we != null && ws !== "" && we !== "") {
    const start = Number(ws);
    const end = Number(we);
    if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start <= 23 && end >= 1 && end <= 24 && start !== end) {
      window = { start, end };
    }
  }

  const locationIds = locationId ? [locationId] : isFullAccess(admin.role) ? undefined : adminLocIds;
  const analytics = await getCheckInAnalytics({ days, locationIds, blockHours, window });
  return NextResponse.json(analytics);
}
