// app/api/admin/locations/[slug]/route.ts
import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { getAdminSession, hasFullAccess } from "@/lib/session.server";

export const runtime = "nodejs";

// Safely extract slug from params or URL
async function getSlug(
  req: Request,
  ctx?: { params?: Promise<{ slug?: string; id?: string }> }
): Promise<string | undefined> {
  let key: string | undefined;
  if (ctx?.params) {
    const p = await ctx.params;
    key = p?.slug ?? p?.id;
  }
  if (key) return key;
  try {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex((seg) => seg === "locations");
    if (idx >= 0 && parts[idx + 1]) {
      return decodeURIComponent(parts[idx + 1]);
    }
  } catch {}
  return undefined;
}

/** GET — scoped */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const slug = await getSlug(req, ctx);
    if (!slug) {
      return NextResponse.json({ ok: false, error: "missing slug" }, { status: 400 });
    }

    // SCOPED: only allow if in their locationSlugs
    if (session.role === "SCOPED") {
      if (!session.locationSlugs?.includes(slug)) {
        return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
    }

    const loc = await getPrisma().location.findUnique({
      where: { slug },
      select: { id: true, slug: true, name: true, disabled: true },
    });

    if (!loc) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, location: loc });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "server error", message: e?.message },
      { status: 500 }
    );
  }
}

/** PATCH — disable/enable: ROOT/FULL only */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getAdminSession();
    if (!session || !hasFullAccess(session)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const slug = await getSlug(req, ctx);
    if (!slug) {
      return NextResponse.json({ ok: false, error: "missing slug" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({} as any));
    if (typeof body?.disabled !== "boolean") {
      return NextResponse.json(
        { ok: false, error: "disabled boolean required" },
        { status: 400 }
      );
    }

    const updated = await getPrisma().location.update({
      where: { slug },
      data: { disabled: body.disabled },
      select: { id: true, slug: true, name: true, disabled: true },
    });

    return NextResponse.json({ ok: true, location: updated });
  } catch (e: any) {
    const status = e?.code === "P2025" ? 404 : 500;
    return NextResponse.json(
      {
        ok: false,
        error: status === 404 ? "location not found" : "server error",
        message: e?.message,
      },
      { status }
    );
  }
}

/** DELETE — full removal: ROOT/FULL only */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getAdminSession();
    if (!session || !hasFullAccess(session)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const slug = await getSlug(req, ctx);
    if (!slug) {
      return NextResponse.json({ ok: false, error: "missing slug" }, { status: 400 });
    }

    const loc = await getPrisma().location.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!loc) {
      return NextResponse.json({ ok: false, error: "location not found" }, { status: 404 });
    }

    // Optional: prevent delete if bays/bookings exist
    const hasData = await getPrisma().$transaction(async (tx) => {
      const bays = await tx.bay.count({ where: { locationId: loc.id } });
      const bookings = await tx.booking.count({ where: { locationId: loc.id } });
      return { bays, bookings };
    });

    if (hasData.bays > 0 || hasData.bookings > 0) {
      return NextResponse.json(
        { ok: false, error: "Cannot delete location with bays or bookings" },
        { status: 400 }
      );
    }

    await getPrisma().$transaction(async (tx) => {
      await tx.booking.deleteMany({ where: { locationId: loc.id } });
      await tx.adminLocation.deleteMany({ where: { locationId: loc.id } });
      await tx.bay.deleteMany({ where: { locationId: loc.id } });
      await tx.location.delete({ where: { id: loc.id } });
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("DELETE /api/admin/locations error:", e);
    return NextResponse.json(
      {
        ok: false,
        error: "server error",
        message: e?.message ?? null,
      },
      { status: 500 }
    );
  }
}