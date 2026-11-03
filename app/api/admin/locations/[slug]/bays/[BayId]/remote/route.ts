import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { getCurrentAdmin, canAccessLocation } from "@/lib/access";
import { getActorContext } from "@/lib/actor";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { deviceSessionUrl, getRemoteConfig } from "@/lib/remote/meshcentral";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/locations/[slug]/bays/[BayId]/remote?view=desktop|terminal|files
 * Returns a one-click MeshCentral session URL for the kiosk PC on this bay.
 *
 * This is full remote control of a PC on the premises, so beyond location
 * access it requires the `scheduling.edit-bay` grant (SCOPED) and is audited.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string; BayId: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { slug, BayId } = await params;
  const location = await getPrisma().location.findUnique({ where: { slug }, select: { id: true } });
  if (!location) return NextResponse.json({ error: "Location not found" }, { status: 404 });
  if (!canAccessLocation(admin.role, admin.locations.map((l) => l.locationId), location.id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const actor = await getActorContext();
  if (!can(actor, "scheduling.edit-bay", { locationId: location.id })) {
    return NextResponse.json({ error: "Forbidden: remote support requires the bay-management permission" }, { status: 403 });
  }

  if (!getRemoteConfig()) {
    return NextResponse.json({ error: "Remote support isn't configured yet (MESHCENTRAL_URL).", code: "NOT_CONFIGURED" }, { status: 409 });
  }

  const bay = await getPrisma().bay.findFirst({ where: { id: BayId, locationId: location.id }, select: { number: true } });
  if (!bay) return NextResponse.json({ error: "Bay not found" }, { status: 404 });

  const reg = await getPrisma().bayAppRegistration.findUnique({
    where: { locationId_bayNumber: { locationId: location.id, bayNumber: bay.number } },
    select: { remoteNodeId: true, hostname: true },
  });
  if (!reg) return NextResponse.json({ error: "No kiosk is installed on this bay yet.", code: "NO_KIOSK" }, { status: 409 });
  if (!reg.remoteNodeId) {
    return NextResponse.json(
      { error: "The remote agent hasn't reported in from this bay yet. Install it from the kiosk's Settings → Remote support.", code: "NO_AGENT", hostname: reg.hostname },
      { status: 409 }
    );
  }

  const view = (req.nextUrl.searchParams.get("view") as "desktop" | "terminal" | "files" | null) ?? "desktop";
  const url = deviceSessionUrl(reg.remoteNodeId, { view });
  if (!url) return NextResponse.json({ error: "Could not build session URL" }, { status: 500 });

  console.log(`[remote] admin ${admin.id} opened ${view} session to ${slug} bay ${bay.number}`);
  void audit({
    actorId: admin.id,
    actorRole: admin.role,
    action: "admin.update",
    entityType: "BayAppRegistration",
    entityId: reg.remoteNodeId,
    metadata: { event: "remote.session-open", view, locationId: location.id, bayNumber: bay.number, hostname: reg.hostname },
  });
  return NextResponse.json({ ok: true, url, expiresInMinutes: 60 });
}
