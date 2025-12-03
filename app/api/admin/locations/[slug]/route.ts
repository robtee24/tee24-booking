// app/api/admin/locations/[slug]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, hasFullAccess } from "@/lib/session.server";
import {
  getAdminLocationBySlug,
  updateLocationDisabled,
  deleteLocation,
} from "@/services/location.service";

export const dynamic = "force-dynamic";

/* ---------------- GET: Single location (scoped access) ---------------- */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getAdminSession();
    if (!session) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    const { slug } = await params;

    // SCOPED: enforce access
    if (session.role === "SCOPED" && !session.locationSlugs?.includes(slug)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const location = await getAdminLocationBySlug(slug);
    return NextResponse.json({ ok: true, location });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 500;
    return NextResponse.json({ ok: false, error: err.message }, { status });
  }
}

/* ---------------- PATCH: Enable/disable ---------------- */
export async function PATCH(req: NextRequest) {
  try {
    const session = await getAdminSession();
    if (!session || !hasFullAccess(session)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const { slug, disabled } = await req.json();
    if (typeof slug !== "string" || typeof disabled !== "boolean") {
      return NextResponse.json(
        { ok: false, error: "slug (string) and disabled (boolean) required" },
        { status: 400 }
      );
    }

    const location = await updateLocationDisabled({ slug, disabled });
    return NextResponse.json({ ok: true, location });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 500;
    return NextResponse.json({ ok: false, error: err.message }, { status });
  }
}

/* ---------------- DELETE: Full removal ---------------- */
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
    const status =
      err.message.includes("not found") ? 404 :
      err.message.includes("Cannot delete") ? 400 : 500;

    return NextResponse.json({ ok: false, error: err.message }, { status });
  }
}