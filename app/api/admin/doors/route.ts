/**
 * GET  /api/admin/doors            → list doors (optionally ?refresh=1 to pull live status from Kisi)
 * POST /api/admin/doors            → { action: "sync" } pull locks/places from Kisi into Door rows
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi, forbidden } from "@/lib/api-auth";
import { isFullAccess } from "@/lib/access";
import { getActorContext } from "@/lib/actor";
import { can } from "@/lib/permissions";
import { kisiConfigured } from "@/lib/kisi";
import { listDoors, refreshDoorStatuses, syncDoorsFromKisi } from "@/services/door.service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  let refreshed = false;
  if (refresh) refreshed = await refreshDoorStatuses();

  const all = await listDoors({ includeHidden: isFullAccess(guard.admin.role) });
  const visible = isFullAccess(guard.admin.role)
    ? all
    : all.filter((d) => d.locationId && guard.admin.locations.some((l) => l.locationId === d.locationId));

  return NextResponse.json({ doors: visible, refreshed, kisiConfigured: kisiConfigured() });
}

export async function POST(req: NextRequest) {
  const actor = await getActorContext();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(actor, "door.manage")) return forbidden();

  const body = await req.json().catch(() => ({}));
  if (body?.action !== "sync") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  if (!kisiConfigured()) return NextResponse.json({ error: "Kisi is not configured (KISI_API_KEY missing)" }, { status: 409 });

  try {
    const r = await syncDoorsFromKisi();
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: (e instanceof Error ? e.message : String(e)) }, { status: 502 });
  }
}
