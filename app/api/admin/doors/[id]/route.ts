/**
 * PATCH /api/admin/doors/:id   → { locationId?: string|null, hidden?: boolean, sortOrder?: number, name?: string }
 * POST  /api/admin/doors/:id   → { action: "unlock" }  remote unlock via Kisi
 */
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { forbidden } from "@/lib/api-auth";
import { getActorContext } from "@/lib/actor";
import { can } from "@/lib/permissions";
import { assignDoorToLocation, unlockDoor, updateDoor } from "@/services/door.service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const actor = await getActorContext();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(actor, "door.manage")) return forbidden();

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  try {
    if ("locationId" in body) {
      const locationId = body.locationId ? String(body.locationId) : null;
      if (locationId && !can(actor, "door.manage", { locationId })) return forbidden();
      await assignDoorToLocation(id, locationId);
    }
    const patch: { hidden?: boolean; sortOrder?: number; name?: string } = {};
    if (typeof body.hidden === "boolean") patch.hidden = body.hidden;
    if (Number.isInteger(body.sortOrder)) patch.sortOrder = body.sortOrder;
    if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
    if (Object.keys(patch).length) await updateDoor(id, patch);

    const door = await getPrisma().door.findUnique({
      where: { id },
      include: { location: { select: { id: true, name: true, slug: true } } },
    });
    return NextResponse.json({ ok: true, door });
  } catch (e) {
    return NextResponse.json({ error: (e instanceof Error ? e.message : String(e)) }, { status: 400 });
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const actor = await getActorContext();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (body?.action !== "unlock") return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  const door = await getPrisma().door.findUnique({ where: { id }, select: { id: true, locationId: true } });
  if (!door) return NextResponse.json({ error: "Door not found" }, { status: 404 });
  if (!can(actor, "door.unlock", { locationId: door.locationId })) return forbidden();

  const admin = await getPrisma().admin.findUnique({ where: { id: actor.id }, select: { name: true, phone: true } });

  try {
    const r = await unlockDoor({ doorId: id, adminId: actor.id, adminLabel: admin?.name ?? admin?.phone ?? undefined });
    return NextResponse.json({ ok: true, message: r.message });
  } catch (e) {
    const msg: string = (e instanceof Error ? e.message : String(e));
    const status = /not configured/i.test(msg) ? 409 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
