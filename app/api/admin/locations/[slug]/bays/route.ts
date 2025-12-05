// app/api/admin/locations/[slug]/bays/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { createBay, getBaysByLocationId } from "@/services/bay.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ---------------- GET: List all bays ---------------- */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await context.params;

    const location = await getPrisma().location.findUnique({
      where: { slug },
      select: { id: true, name: true, slug: true },
    });
    if (!location) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    const bays = await getBaysByLocationId(location.id);

    return NextResponse.json({ location, bays });
  } catch (e: any) {
    console.error("GET bays error", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

/* ---------------- POST: Create new bay ---------------- */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await context.params;

    const location = await getPrisma().location.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!location) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    const body = await request.json();

    // Map frontend payload
    const input: Parameters<typeof createBay>[1] = {
      number: Number(body.number),
      name: body.name?.toString().trim() || null,
      kind: body.kind === "SINGLE" || body.kind === "GROUP" ? body.kind : "GROUP",
      disabled: Boolean(body.disabled),
    };

    if (input.kind === "SINGLE") {
      if (!body.handedness || !["RH", "LH"].includes(body.handedness)) {
        return NextResponse.json({ error: "Handedness required for SINGLE bay" }, { status: 400 });
      }
      input.handedness = body.handedness;
    } else {
      input.capacity = body.capacity ? Math.max(2, Number(body.capacity)) : 4;
    }

    const bay = await createBay(location.id, input);

    return NextResponse.json({ ok: true, bay });
  } catch (e: any) {
    console.error("POST bay error", e);

    if (e?.code === "P2002") {
      return NextResponse.json({ error: "Bay number already exists" }, { status: 409 });
    }
    if (e?.message?.includes?.("must be")) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }

    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}