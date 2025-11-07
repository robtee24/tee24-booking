// app/api/admin/locations/route.ts
import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";

export const runtime = "nodejs";

// GET: list (works even before adding `disabled` column)
export async function GET() {
  try {
    const rows = await getPrisma().location.findMany({
      select: { id: true, name: true, slug: true }, // NOTE: no 'disabled' here
      orderBy: { name: "asc" },
    });
    return NextResponse.json({
      ok: true,
      locations: rows.map((l) => ({ ...l, disabled: false })), // default for UI
    });
  } catch (e: any) {
    console.error("GET /api/admin/locations error:", e?.message || e);
    return NextResponse.json({ ok: false, error: "server error" }, { status: 500 });
  }
}

// POST: create { name, slug }
export async function POST(req: Request) {
  try {
    const { name, slug } = (await req.json()) as { name?: string; slug?: string };
    if (!name || !slug) {
      return NextResponse.json({ ok: false, error: "name and slug are required" }, { status: 400 });
    }

    const cleanName = String(name).trim();
    const cleanSlug = String(slug)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    if (!cleanName || !cleanSlug) {
      return NextResponse.json({ ok: false, error: "invalid name or slug" }, { status: 400 });
    }

    const exists = await getPrisma().location.findUnique({ where: { slug: cleanSlug } });
    if (exists) {
      return NextResponse.json({ ok: false, error: "slug already exists" }, { status: 409 });
    }

    const loc = await getPrisma().location.create({
      data: {
        name: cleanName,
        slug: cleanSlug,
        bookingNote: "",
        emailTemplate:
          '<p>Hi {{firstName}},</p><p>Confirmed for {{date}} {{start}}–{{end}} at <strong>{{locationName}}</strong>, Bay {{bayNumber}}.</p><p>{{bookingNote}}</p><p>Manage: <a href="{{manageUrl}}">{{manageUrl}}</a></p>',
        smsTemplate:
          "Tee24: {{firstName}} your bay {{bayNumber}} at {{locationName}} is booked for {{date}} {{start}}–{{end}}. Manage: {{manageUrl}}",

        // ✅ REQUIRED: provide a default for non-null JSON column `hours`
        // Keep {} or use a simple weekly default (example below).
        hours: {},

        // Example weekly default:
        // hours: {
        //   mon: [["08:00", "22:00"]],
        //   tue: [["08:00", "22:00"]],
        //   wed: [["08:00", "22:00"]],
        //   thu: [["08:00", "22:00"]],
        //   fri: [["08:00", "22:00"]],
        //   sat: [["08:00", "22:00"]],
        //   sun: [["08:00", "22:00"]],
        // },
      },
      select: { id: true, name: true, slug: true }, // NOTE: no 'disabled' here
    });

    // Return disabled:false for UI compatibility
    return NextResponse.json({ ok: true, location: { ...loc, disabled: false } }, { status: 201 });
  } catch (e: any) {
    console.error("POST /api/admin/locations error:", e?.code, e?.message, e?.stack);
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



