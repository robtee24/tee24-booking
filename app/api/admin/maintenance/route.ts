import { NextRequest, NextResponse } from "next/server";
import { requireLocationAdminApi } from "@/lib/api-auth";
import { getActorContext } from "@/lib/actor";
import { assertCan, ForbiddenError } from "@/lib/permissions";
import { getPrisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const KINDS = new Set(["ISSUE", "RESOLVED", "INSPECTION", "NOTE"]);

/** POST { locationId, bayId?, kind, body } — permission ops.maintenance, scoped to the location. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const locationId = typeof body.locationId === "string" ? body.locationId : null;
  if (!locationId) return NextResponse.json({ error: "locationId is required" }, { status: 400 });

  // Location access (SCOPED admins can only log against their own locations).
  const guard = await requireLocationAdminApi({ locationId });
  if (!guard.ok) return guard.response;

  try {
    const actor = await getActorContext();
    assertCan(actor, "ops.maintenance", { locationId });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }

  const kind = typeof body.kind === "string" && KINDS.has(body.kind) ? body.kind : null;
  const text = typeof body.body === "string" ? body.body.trim().slice(0, 4000) : "";
  if (!kind || !text) return NextResponse.json({ error: "kind and body are required" }, { status: 400 });

  // A bay reference must belong to the same location.
  let bayId: string | null = null;
  if (typeof body.bayId === "string" && body.bayId) {
    const bay = await getPrisma().bay.findFirst({ where: { id: body.bayId, locationId }, select: { id: true } });
    if (!bay) return NextResponse.json({ error: "Bay not found at this location" }, { status: 404 });
    bayId = bay.id;
  }

  const log = await getPrisma().maintenanceLog.create({
    data: {
      locationId,
      bayId,
      kind,
      body: text,
      reporterId: guard.admin.id,
      resolvedAt: kind === "RESOLVED" ? new Date() : null,
    },
  });
  return NextResponse.json({ ok: true, log });
}
