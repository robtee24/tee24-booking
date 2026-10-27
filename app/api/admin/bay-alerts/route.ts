// /api/admin/bay-alerts?locationSlug=   → { items }   (guest-violation alerts from the bay kiosks)
// POST { id, action: 'review', notes? }
import { NextResponse, type NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { requireAdminApi, requireLocationAdminApi } from "@/lib/api-auth";
import { listGuestViolations, reviewGuestViolation } from "@/services/bay-players.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const slug = (req.nextUrl.searchParams.get("locationSlug") ?? "").trim();
  if (!slug) return NextResponse.json({ error: "Missing locationSlug" }, { status: 400 });
  const guard = await requireLocationAdminApi({ locationSlug: slug });
  if (!guard.ok) return guard.response;
  if (!guard.location) return NextResponse.json({ error: "Location not found" }, { status: 404 });
  const items = await listGuestViolations(guard.location.id);
  return NextResponse.json({ ok: true, items });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const v = await getPrisma().guestViolation.findUnique({ where: { id }, select: { locationId: true } });
  if (!v) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const loc = await requireLocationAdminApi({ locationId: v.locationId });
  if (!loc.ok) return loc.response;
  if (String(body.action ?? "") !== "review") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) || null : null;
  return NextResponse.json(await reviewGuestViolation(id, guard.admin.id, notes));
}
