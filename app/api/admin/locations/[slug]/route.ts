// app/api/admin/locations/[slug]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// Derive slug safely from Next params OR from the URL path as a fallback
function getSlug(req: Request, params: Record<string, string | undefined> | undefined) {
  const p = params || {};
  const key = p.slug ?? (p as any)?.id;
  if (key) return key;

  // Fallback: parse from URL: /api/admin/locations/:slug
  try {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    // [..., "api","admin","locations",":slug"]
    const idx = parts.findIndex((seg) => seg === "locations");
    if (idx >= 0 && parts[idx + 1]) return decodeURIComponent(parts[idx + 1]);
  } catch {}
  return undefined;
}

/** GET: existence + disabled state */
export async function GET(req: Request, ctx: { params?: Record<string, string | undefined> }) {
  try {
    const slug = getSlug(req, ctx?.params);
    if (!slug) return NextResponse.json({ ok: false, error: "missing slug" }, { status: 400 });

    const loc = await prisma.location.findUnique({
      where: { slug },
      select: { id: true, slug: true, name: true, disabled: true },
    });
    if (!loc) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, location: loc });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "server error", code: e?.code, message: e?.message },
      { status: 500 }
    );
  }
}

/** PATCH /api/admin/locations/:slug  body: { disabled: boolean } */
export async function PATCH(req: Request, ctx: { params?: Record<string, string | undefined> }) {
  try {
    const slug = getSlug(req, ctx?.params);
    if (!slug) return NextResponse.json({ ok: false, error: "missing slug" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    if (typeof body?.disabled !== "boolean") {
      return NextResponse.json({ ok: false, error: "disabled boolean required" }, { status: 400 });
    }

    const updated = await prisma.location.update({
      where: { slug },
      data: { disabled: body.disabled },
      select: { id: true, slug: true, name: true, disabled: true },
    });

    return NextResponse.json({ ok: true, location: updated });
  } catch (e: any) {
    const status = e?.code === "P2025" ? 404 : 500;
    return NextResponse.json(
      { ok: false, error: status === 404 ? "location not found" : "server error", code: e?.code, message: e?.message },
      { status }
    );
  }
}

/** DELETE /api/admin/locations/:slug */
export async function DELETE(req: Request, ctx: { params?: Record<string, string | undefined> }) {
  try {
    const slug = getSlug(req, ctx?.params);
    if (!slug) return NextResponse.json({ ok: false, error: "missing slug" }, { status: 400 });

    await prisma.location.delete({ where: { slug } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e?.code === "P2025") {
      return NextResponse.json({ ok: false, error: "location not found", code: e?.code }, { status: 404 });
    }
    return NextResponse.json(
      { ok: false, error: "cannot delete location (has dependencies?)", code: e?.code, message: e?.message },
      { status: 400 }
    );
  }
}



