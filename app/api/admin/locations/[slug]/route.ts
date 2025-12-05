// app/api/admin/locations/[slug]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, hasFullAccess } from "@/lib/session.server";
import {
  getAdminLocationDetails,
  updateLocationDisabled,
  deleteLocation,
} from "@/services/location.service";

export const dynamic = "force-dynamic";

/* ---------------- GET: Full location details (scoped access respected) ---------------- */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const { slug } = await params;

    // Enforce scoped access
    if (session.role === "SCOPED" && !session.locationSlugs?.includes(slug)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const location = await getAdminLocationDetails(slug);

    return NextResponse.json({ ok: true, location });
  } catch (err: any) {
    console.error(`GET /api/admin/locations/${err.message}`);
    const status = err.message.includes("not found") ? 404 : 500;
    return NextResponse.json(
      { ok: false, error: err.message || "Server error" },
      { status }
    );
  }
}

/* ---------------- PATCH: Toggle disabled ---------------- */
export async function PATCH(req: NextRequest) {
  try {
    const session = await getAdminSession();
    if (!session || !hasFullAccess(session)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { disabled } = body;

    if (typeof disabled !== "boolean") {
      return NextResponse.json(
        { ok: false, error: "disabled boolean is required" },
        { status: 400 }
      );
    }

    // Extract slug from URL in PATCH (since no params in body ideally)
    const url = req.url;
    const slug = url.split("/").slice(-1)[0];
    if (!slug) {
      return NextResponse.json(
        { ok: false, error: "Invalid URL" },
        { status: 400 }
      );
    }

    const location = await updateLocationDisabled({ slug, disabled });

    return NextResponse.json({ ok: true, location });
  } catch (err: any) {
    console.error("PATCH /api/admin/locations/[slug] error:", err);
    const status = err.message.includes("not found") ? 404 : 500;
    return NextResponse.json(
      { ok: false, error: err.message || "Server error" },
      { status }
    );
  }
}

/* ---------------- DELETE: Remove location (with safety checks) ---------------- */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getAdminSession();
    if (!session || !hasFullAccess(session)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const { slug } = await params;

    await deleteLocation(slug);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("DELETE /api/admin/locations/[slug] error:", err);

    const message = err.message.toLowerCase();
    const status =
      message.includes("not found")
        ? 404
        : message.includes("cannot delete")
        ? 400
        : 500;

    return NextResponse.json(
      { ok: false, error: err.message || "Failed to delete location" },
      { status }
    );
  }
}