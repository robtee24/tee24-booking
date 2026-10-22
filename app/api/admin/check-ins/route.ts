/**
 * GET  /api/admin/check-ins?range=today|7d|30d|90d|all&locationId=&q=&offset=&limit=&view=list|by-member|overview
 * POST /api/admin/check-ins  { action: "sync" }  → pull recent unlock events from Kisi now
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi, forbidden } from "@/lib/api-auth";
import { canAccessLocation, isFullAccess } from "@/lib/access";
import { getActorContext } from "@/lib/actor";
import { can } from "@/lib/permissions";
import { kisiConfigured } from "@/lib/kisi";
import {
  getCheckInOverview,
  getCheckInsByMember,
  listCheckIns,
  syncKisiUnlockEvents,
  type CheckInRange,
} from "@/services/door.service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RANGES: CheckInRange[] = ["today", "7d", "30d", "90d", "all"];

export async function GET(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const sp = req.nextUrl.searchParams;
  const range = (RANGES.includes(sp.get("range") as CheckInRange) ? sp.get("range") : "30d") as CheckInRange;
  const locationId = sp.get("locationId") || undefined;
  const view = sp.get("view") ?? "list";
  const adminLocIds = admin.locations.map((l) => l.locationId);

  if (locationId && !canAccessLocation(admin.role, adminLocIds, locationId)) return forbidden();

  if (view === "overview") {
    const overview = await getCheckInOverview(range, isFullAccess(admin.role) ? undefined : adminLocIds);
    return NextResponse.json({ range, overview });
  }

  if (view === "by-member") {
    if (!locationId) return NextResponse.json({ error: "locationId required" }, { status: 400 });
    const rows = await getCheckInsByMember({ range, locationId });
    return NextResponse.json({ range, rows });
  }

  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 100), 1), 500);
  const offset = Math.max(Number(sp.get("offset") ?? 0), 0);
  const q = sp.get("q") ?? undefined;
  const memberId = sp.get("memberId") ?? undefined;

  // Scoped admins without an explicit location: restrict to their locations.
  if (!locationId && !isFullAccess(admin.role)) {
    const results = await Promise.all(
      adminLocIds.map((id) => listCheckIns({ range, locationId: id, q, memberId, limit, offset }))
    );
    const rows = results.flatMap((r) => r.rows).sort((a, b) => b.enteredAt.getTime() - a.enteredAt.getTime()).slice(0, limit);
    const total = results.reduce((s, r) => s + r.total, 0);
    return NextResponse.json({ range, rows, total });
  }

  const r = await listCheckIns({ range, locationId, q, memberId, limit, offset });
  return NextResponse.json({ range, ...r });
}

export async function POST(req: NextRequest) {
  const actor = await getActorContext();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(actor, "door.manage")) return forbidden();

  const body = await req.json().catch(() => ({}));
  if (body?.action !== "sync") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  if (!kisiConfigured()) return NextResponse.json({ error: "Kisi is not configured (KISI_API_KEY missing)" }, { status: 409 });

  try {
    const days = Math.min(Math.max(Number(body.days ?? 0), 0), 89);
    const since = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : undefined;
    const r = await syncKisiUnlockEvents({ since });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: (e instanceof Error ? e.message : String(e)) }, { status: 502 });
  }
}
