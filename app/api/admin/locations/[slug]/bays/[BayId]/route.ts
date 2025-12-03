// app/api/admin/locations/[slug]/bays/[BayId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { updateBay, deleteBay } from "@/services/bay.service";

export const dynamic = "force-dynamic";

/* ---------------- PATCH: Update bay ---------------- */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; BayId: string }> }
) {
  try {
    const { slug, BayId } = await params;

    const location = await getPrisma().location.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!location) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    const body = await req.json();

    const bay = await updateBay(location.id, {
      bayId: BayId,
      number: body.number,
      name: body.name ?? undefined,
      kind: body.kind,
      handedness: body.handedness ?? undefined,
      capacity: body.capacity,
    });

    return NextResponse.json({ ok: true, bay });
  } catch (err: any) {
    console.error("PATCH bay error:", err);

    const status =
      err.message.includes("already exists") ? 409 :
      err.message.includes("required") || err.message.includes("Invalid") ? 400 :
      err.message.includes("not found") ? 404 :
      500;

    return NextResponse.json({ error: err.message || "Server error" }, { status });
  }
}

/* ---------------- DELETE: Remove bay (blocks if future bookings) ---------------- */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; BayId: string }> }
) {
  try {
    const { slug, BayId } = await params;

    const location = await getPrisma().location.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!location) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    await deleteBay(location.id, BayId);

    return NextResponse.json({ ok: true, deletedId: BayId });
  } catch (err: any) {
    console.error("DELETE bay error:", err);

    const status =
      err.message.includes("future booking") ? 409 :
      err.message.includes("not found") ? 404 :
      500;

    return NextResponse.json({ error: err.message || "Server error" }, { status });
  }
}