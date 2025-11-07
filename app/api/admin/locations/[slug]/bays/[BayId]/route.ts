// app/api/admin/locations/[slug]/bays/[BayId]/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---------- helpers ----------
function intOrNaN(v: any) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : NaN;
}
function isDigits(s: unknown) {
  return typeof s === "string" && /^\d+$/.test(s.trim());
}
function toKind(v: any): "SINGLE" | "GROUP" | null {
  return v === "SINGLE" || v === "GROUP" ? v : null;
}
function toHanded(v: any): "RH" | "LH" | null {
  return v === "RH" || v === "LH" ? v : null;
}

/**
 * PATCH /api/admin/locations/[slug]/bays/[BayId]
 * Body (partial allowed):
 *   {
 *     number?: number (>0)
 *     name?: string | null       // digits-only or null to clear
 *     kind?: "SINGLE" | "GROUP"
 *     handedness?: "RH" | "LH" | null
 *     capacity?: number          // ignored for SINGLE (forced to 1); >=2 for GROUP
 *   }
 * Notes:
 *  - Validates that the bay belongs to the given location slug.
 *  - Enforces rules:
 *      SINGLE  -> handedness required; capacity=1
 *      GROUP   -> handedness=null;   capacity>=2 (defaults to 4 if missing)
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ slug: string; BayId: string }> }
) {
  try {
    const { slug, BayId } = await context.params;
    const body = await request.json().catch(() => ({} as any));

    // Find location & bay (ensure bay belongs to this location)
    const location = await getPrisma().location.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!location) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    const existing = await getPrisma().bay.findFirst({
      where: { id: BayId, locationId: location.id },
      select: {
        id: true,
        number: true,
        name: true,
        kind: true,
        handedness: true,
        capacity: true,
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Bay not found" }, { status: 404 });
    }

    // Parse incoming fields
    const data: Record<string, any> = {};

    if (typeof body.number !== "undefined") {
      const n = intOrNaN(body.number);
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json({ error: "Invalid bay number" }, { status: 400 });
      }
      data.number = n;
    }

    if (typeof body.name !== "undefined") {
      if (body.name === null || body.name === "") {
        data.name = null;
      } else if (typeof body.name === "string" && isDigits(body.name)) {
        data.name = body.name.trim();
      } else {
        return NextResponse.json(
          { error: "Display name must be digits only (or leave blank)." },
          { status: 400 }
        );
      }
    }

    // Accept kind/handedness/capacity but enforce rules after we know the nextKind
    const incomingKind = typeof body.kind !== "undefined" ? toKind(body.kind) : null;
    if (typeof body.kind !== "undefined" && !incomingKind) {
      return NextResponse.json({ error: "Invalid kind (use SINGLE or GROUP)" }, { status: 400 });
    }
    const nextKind: "SINGLE" | "GROUP" = incomingKind ?? existing.kind;

    const incomingHand = typeof body.handedness !== "undefined" ? (body.handedness === null ? null : toHanded(body.handedness)) : undefined;
    if (typeof body.handedness !== "undefined" && body.handedness !== null && !incomingHand) {
      return NextResponse.json({ error: "Invalid handedness (use RH or LH)" }, { status: 400 });
    }

    const incomingCapacity = typeof body.capacity !== "undefined" ? intOrNaN(body.capacity) : undefined;
    if (typeof incomingCapacity !== "undefined" && (!Number.isFinite(incomingCapacity) || incomingCapacity <= 0)) {
      return NextResponse.json({ error: "Invalid capacity" }, { status: 400 });
    }

    // Apply business rules
    if (nextKind === "SINGLE") {
      const finalHand = incomingHand ?? existing.handedness;
      if (!finalHand) {
        return NextResponse.json(
          { error: "Handedness is required for SINGLE bays (RH or LH)." },
          { status: 400 }
        );
      }
      data.kind = "SINGLE";
      data.handedness = finalHand;
      data.capacity = 1; // enforce
    } else {
      // GROUP
      data.kind = "GROUP";
      data.handedness = null; // ignore handedness for group bays
      const cap = typeof incomingCapacity !== "undefined" ? incomingCapacity : existing.capacity ?? 4;
      data.capacity = Math.max(2, cap);
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const updated = await getPrisma().bay.update({
      where: { id: existing.id },
      data,
      select: {
        id: true,
        number: true,
        name: true,
        kind: true,
        handedness: true,
        capacity: true,
      },
    });

    return NextResponse.json({ ok: true, bay: updated });
  } catch (e: any) {
    console.error("PATCH /admin bay error", e);
    if (e?.code === "P2002") {
      return NextResponse.json(
        { error: "That bay number already exists for this location." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/locations/[slug]/bays/[BayId]
 * - Refuses to delete if there are future bookings for this bay.
 */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ slug: string; BayId: string }> }
) {
  try {
    const { slug, BayId } = await context.params;

    const location = await getPrisma().location.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!location) return NextResponse.json({ error: "Location not found" }, { status: 404 });

    const bay = await getPrisma().bay.findFirst({
      where: { id: BayId, locationId: location.id },
      select: { id: true, number: true },
    });
    if (!bay) return NextResponse.json({ error: "Bay not found" }, { status: 404 });

    // Block delete if there are any future bookings for this bay
    const now = new Date();
    const futureCount = await getPrisma().booking.count({
      where: {
        locationId: location.id,
        bayNumber: bay.number,
        start: { gte: now },
      },
    });
    if (futureCount > 0) {
      return NextResponse.json(
        { error: "Cannot delete bay: there are future bookings for this bay. Cancel/move them first.", futureBookings: futureCount },
        { status: 409 }
      );
    }

    await getPrisma().bay.delete({ where: { id: bay.id } });
    return NextResponse.json({ ok: true, deletedId: bay.id });
  } catch (e: any) {
    console.error("DELETE /admin bay error", e);
    const msg = process.env.NODE_ENV === "development" ? e?.message || "Server error" : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

