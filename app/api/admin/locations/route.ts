// app/api/admin/locations/route.ts
import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { getAdminSession, hasFullAccess } from "@/lib/session.server";

export const runtime = "nodejs";

/* ---------------- GET: list (filtered by scope) ---------------- */
export async function GET() {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    let locations;
    if (session.role === "SCOPED" && session.locationSlugs?.length) {
      locations = await getPrisma().location.findMany({
        where: { slug: { in: session.locationSlugs } },
        select: { id: true, name: true, slug: true },
        orderBy: { name: "asc" },
      });
    } else {
      locations = await getPrisma().location.findMany({
        select: { id: true, name: true, slug: true },
        orderBy: { name: "asc" },
      });
    }

    return NextResponse.json({
      ok: true,
      locations: locations.map((l) => ({ ...l, disabled: false })),
    });
  } catch (e: any) {
    console.error("GET /api/admin/locations error:", e?.message || e);
    return NextResponse.json({ ok: false, error: "server error" }, { status: 500 });
  }
}

/* ---------------- POST: create { name, slug } — ONLY ROOT or FULL ---------------- */
export async function POST(req: Request) {
  try {
    const session = await getAdminSession();
    if (!session || !hasFullAccess(session)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const { name, slug } = (await req.json()) as { name?: string; slug?: string };
    if (!name || !slug) {
      return NextResponse.json(
        { ok: false, error: "name and slug are required" },
        { status: 400 }
      );
    }

    const cleanName = String(name).trim();
    const cleanSlug = String(slug)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    if (!cleanName || !cleanSlug) {
      return NextResponse.json(
        { ok: false, error: "invalid name or slug" },
        { status: 400 }
      );
    }

    const exists = await getPrisma().location.findUnique({ where: { slug: cleanSlug } });
    if (exists) {
      return NextResponse.json(
        { ok: false, error: "slug already exists" },
        { status: 409 }
      );
    }

    // -----------------------------------------------------------------
    // 1. Create the Location (only fields that still exist)
    // -----------------------------------------------------------------
    const loc = await getPrisma().location.create({
      data: {
        name: cleanName,
        slug: cleanSlug,
        bookingNote: "",
        hours: {}, // JSON stored as TEXT in the DB
      },
      select: { id: true, name: true, slug: true },
    });

    // -----------------------------------------------------------------
    // 2. Insert default confirmation templates into Notification table
    // -----------------------------------------------------------------
    const defaultEmail = `<p>Hi {{firstName}},</p>
<p>Confirmed for {{date}} {{start}}–{{end}} at <strong>{{locationName}}</strong>, Bay {{bayNumber}}.</p>
<p>{{bookingNote}}</p>
<p>Manage: <a href="{{manageUrl}}">{{manageUrl}}</a></p>`;

    const defaultSms = `Tee24: {{firstName}} your bay {{bayNumber}} at {{locationName}} is booked for {{date}} {{start}}–{{end}}. Manage: {{manageUrl}}`;

    await getPrisma().$transaction(async (tx) => {
      // EMAIL confirmation
      await tx.notification.create({
        data: {
          locationId: loc.id,
          kind: "CONFIRMATION",
          channel: "EMAIL",
          hoursBefore: 0,
          enabled: true,
          template: defaultEmail,
          order: 0,
        },
      });

      // SMS confirmation
      await tx.notification.create({
        data: {
          locationId: loc.id,
          kind: "CONFIRMATION",
          channel: "TEXT",
          hoursBefore: 0,
          enabled: true,
          template: defaultSms,
          order: 0,
        },
      });
    });

    return NextResponse.json(
      { ok: true, location: { ...loc, disabled: false } },
      { status: 201 }
    );
  } catch (e: any) {
    console.error(
      "POST /api/admin/locations error:",
      e?.code,
      e?.message,
      e?.stack
    );
    return NextResponse.json(
      {
        ok: false,
        error: "server error",
        code: e?.code ?? null,
        message: e?.message ?? null,
      },
      { status: 500 }
    );
  }
}