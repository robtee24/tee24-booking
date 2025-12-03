// app/api/admin/locations/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, hasFullAccess } from "@/lib/session.server";
import {
  getAdminLocations,
  createLocation,
} from "@/services/location.service";

export const dynamic = "force-dynamic";

/* ---------------- GET: List locations (respects scoped access) ---------------- */
export async function GET() {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const locations = await getAdminLocations({
      role: session.role,
      locationSlugs: session.locationSlugs,
    });

    return NextResponse.json({ ok: true, locations });
  } catch (err: any) {
    console.error("GET /admin/locations error:", err);
    return NextResponse.json(
      { ok: false, error: "Server error" },
      { status: 500 }
    );
  }
}

/* ---------------- POST: Create new location (ROOT/FULL only) ---------------- */
export async function POST(req: NextRequest) {
  try {
    const session = await getAdminSession();
    if (!session || !hasFullAccess(session)) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { name, slug } = body;

    if (!name || !slug) {
      return NextResponse.json(
        { ok: false, error: "name and slug are required" },
        { status: 400 }
      );
    }

    const location = await createLocation({ name, slug });

    return NextResponse.json(
      { ok: true, location },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("POST /admin/locations error:", err);

    // Friendly error mapping
    const status =
      err.message.includes("Forbidden") ? 403 :
      err.message.includes("exists") ? 409 :
      err.message.includes("invalid") ? 400 :
      500;

    return NextResponse.json(
      { ok: false, error: err.message || "Server error" },
      { status }
    );
  }
}