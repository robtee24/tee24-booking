// app/api/admin/locations/[slug]/route.ts
import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";

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

  // Fallback: parse from /api/admin/locations/:slug
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

/** GET */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ slug: string }> }
) {
  try {
    const slug = await getSlug(req, ctx);
    if (!slug)
      return NextResponse.json({ ok: false, error: "missing slug" }, { status: 400 });

    const loc = await getPrisma().location.findUnique({
      where: { slug },
      select: { id: true, slug: true, name: true, disabled: true },
    });
    if (!loc)
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

    return NextResponse.json({ ok: true, location: loc });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "server error", message: e?.message },
      { status: 500 }
    );
  }
}

/** PATCH */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ slug: string }> }
) {
  try {
    const slug = await getSlug(req, ctx);
    if (!slug)
      return NextResponse.json({ ok: false, error: "missing slug" }, { status: 400 });

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

/** DELETE — forcibly remove location and all dependencies */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ slug: string }> }
) {
  try {
    const slug = await getSlug(req, ctx);
    if (!slug)
      return NextResponse.json({ ok: false, error: "missing slug" }, { status: 400 });

    const loc = await getPrisma().location.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!loc)
      return NextResponse.json({ ok: false, error: "location not found" }, { status: 404 });

    // Transaction: delete all dependent data before location
    await getPrisma().$transaction(async (tx) => {
      try {
        await tx.booking.deleteMany({ where: { locationId: loc.id } });
      } catch {}
      try {
        await tx.adminLocation.deleteMany({ where: { locationId: loc.id } });
      } catch {}
      try {
        await tx.bay.deleteMany({ where: { locationId: loc.id } });
      } catch {}
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
