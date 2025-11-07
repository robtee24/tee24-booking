// app/api/admin/locations/[slug]/bays/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Helpers
function parseIntSafe(v: any) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : NaN;
}
function isDigits(s: unknown) {
  return typeof s === "string" && /^\d+$/.test(s.trim());
}
function toKind(v: any): "SINGLE" | "GROUP" | null {
  if (v === "SINGLE" || v === "GROUP") return v;
  return null;
}
function toHanded(v: any): "RH" | "LH" | null {
  if (v === "RH" || v === "LH") return v;
  return null;
}

/**
 * GET /api/admin/locations/[slug]/bays
 * Lists all bays for a location.
 * Next 16: context.params is a Promise<{ slug: string }>
 */
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

    const bays = await getPrisma().bay.findMany({
      where: { locationId: location.id },
      orderBy: { number: "asc" },
      select: {
        id: true,
        number: true,
        name: true,
        kind: true,        // 'SINGLE' | 'GROUP'
        handedness: true,  // 'RH' | 'LH' | null
        capacity: true,    // int
      },
    });

    return NextResponse.json({ location, bays });
  } catch (e: any) {
    console.error("GET bays error", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

/**
 * POST /api/admin/locations/[slug]/bays
 * Body:
 *   {
 *     number: Int (required, >0),
 *     name?: String (digits only or omitted/null/""),
 *     kind: "SINGLE" | "GROUP" (required),
 *     handedness?: "RH" | "LH"  (required for SINGLE; ignored for GROUP),
 *     capacity?: Int            (>=2 for GROUP; forced to 1 for SINGLE)
 *   }
 *
 * Next 16: context.params is a Promise<{ slug: string }>
 */
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

    const body = await request.json().catch(() => ({} as any));

    // number
    const number = parseIntSafe(body.number);
    if (!Number.isFinite(number) || number <= 0) {
      return NextResponse.json({ error: "Invalid bay number" }, { status: 400 });
    }

    // name (optional, digits-only)
    let name: string | null = null;
    if (body.name !== undefined && body.name !== null && body.name !== "") {
      if (!isDigits(body.name)) {
        return NextResponse.json(
          { error: "Bay name must be numeric only (digits 0–9)." },
          { status: 400 }
        );
      }
      name = String(body.name).trim();
    }

    // kind
    const kind = toKind(body.kind) ?? "GROUP"; // default to GROUP if not provided
    // handedness / capacity per rules
    let handedness: "RH" | "LH" | null = null;
    let capacity: number;

    if (kind === "SINGLE") {
      const h = toHanded(body.handedness);
      if (!h) {
        return NextResponse.json(
          { error: "Handedness is required for SINGLE bays (RH or LH)." },
          { status: 400 }
        );
      }
      handedness = h;
      capacity = 1; // enforce
    } else {
      // GROUP
      const capRaw = parseIntSafe(body.capacity);
      capacity = Number.isFinite(capRaw) ? capRaw : 4;
      if (capacity < 2) capacity = 2;
      handedness = null; // ignore
    }

    const bay = await getPrisma().bay.create({
      data: {
        locationId: location.id,
        number,
        name,
        kind,
        handedness,
        capacity,
      },
      select: {
        id: true,
        number: true,
        name: true,
        kind: true,
        handedness: true,
        capacity: true,
      },
    });

    return NextResponse.json({ ok: true, bay });
  } catch (e: any) {
    console.error("POST bay error", e);
    if (e?.code === "P2002") {
      return NextResponse.json(
        { error: "That bay number already exists for this location." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}



