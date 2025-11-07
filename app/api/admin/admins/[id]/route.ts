// app/api/admin/admins/[id]/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { getAdminSession, isRoot } from "@/lib/session.server";
import type { AdminRole } from "@prisma/client";

/* ---------------- helpers ---------------- */
function json(data: any, init?: number | ResponseInit) {
  return NextResponse.json(data, init as any);
}

function devBypass(req: Request): boolean {
  const hdr = req.headers.get("x-dev-root");
  const secret = process.env.CRON_SECRET || "";
  return !!hdr && !!secret && hdr === secret;
}

/** Robustly pull :id out of ctx.params */
async function getParamId(
  req: Request,
  ctx?: { params?: Promise<{ id?: string | string[] }> }
): Promise<string> {
  let raw: string | string[] | undefined;
  if (ctx?.params) {
    const p = await ctx.params;
    raw = p?.id;
  }
  if (!raw) {
    const match = new URL(req.url).pathname.match(/\/api\/admin\/admins\/([^/?#]+)/);
    raw = match?.[1];
  }
  if (!raw) return "";
  const id = Array.isArray(raw) ? raw[0] : raw;
  return decodeURIComponent(String(id));
}

/** New: Scoped authorization for edit/delete */
async function authorizeAdminMutation(
  session: Awaited<ReturnType<typeof getAdminSession>>,
  targetId: string
): Promise<{ ok: boolean; res?: Response }> {
  if (!session) {
    return { ok: false, res: json({ error: "Forbidden" }, { status: 403 }) };
  }

  // Dev bypass
  if (devBypass(new Request(new URL("/api/admin/admins", "http://localhost")))) {
    return { ok: true };
  }

  if (session.id === targetId) {
    return { ok: false, res: json({ error: "Cannot modify self" }, { status: 403 }) };
  }

  const target = await getPrisma().admin.findUnique({
    where: { id: targetId },
    select: { role: true },
  });

  if (!target) {
    return { ok: false, res: json({ error: "not found" }, { status: 404 }) };
  }

  // ROOT can do anything
  if (isRoot(session)) {
    return { ok: true };
  }

  // FULL can only modify SCOPED
  if (session.role === "FULL") {
    if (target.role !== "SCOPED") {
      return { ok: false, res: json({ error: "Forbidden" }, { status: 403 }) };
    }
    return { ok: true };
  }

  // SCOPED: target must be SCOPED and share a location
  if (session.role === "SCOPED") {
    if (target.role !== "SCOPED") {
      return { ok: false, res: json({ error: "Forbidden" }, { status: 403 }) };
    }

    if (!session.locationSlugs?.length) {
      return { ok: false, res: json({ error: "No locations assigned" }, { status: 403 }) };
    }

    const shared = await getPrisma().adminLocation.count({
      where: {
        adminId: session.id,
        location: {
          adminLinks: {
            some: { adminId: targetId },
          },
        },
      },
    });

    if (shared === 0) {
      return { ok: false, res: json({ error: "Forbidden" }, { status: 403 }) };
    }

    return { ok: true };
  }

  return { ok: false, res: json({ error: "Forbidden" }, { status: 403 }) };
}

/** New: Validate locationIds are in current admin's scope */
async function validateLocationIds(
  session: Awaited<ReturnType<typeof getAdminSession>>,
  locationIds: string[]
): Promise<{ valid: boolean; message?: string }> {
  if (!session || !session.locationSlugs?.length) return { valid: true }; // ROOT/FULL

  const uniqueIds = Array.from(new Set(locationIds));
  const invalid = uniqueIds.filter((id) => !session.locationSlugs!.includes(id));
  if (invalid.length > 0) {
    return { valid: false, message: `Invalid location slugs: ${invalid.join(", ")}` };
  }
  return { valid: true };
}

/* ---------------- GET ---------------- */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getAdminSession();
  if (!session) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const id = await getParamId(req, ctx);
  if (!id) return json({ error: "missing id" }, { status: 400 });

  // SCOPED: check if target is in scope
  if (session.role === "SCOPED") {
    const auth = await authorizeAdminMutation(session, id);
    if (!auth.ok) return auth.res!;
  } else if (!isRoot(session) && session.role !== "FULL") {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = await getPrisma().admin.findUnique({
    where: { id },
    include: {
      locations: {
        include: { location: { select: { id: true, name: true, slug: true } } },
      },
    },
  });

  if (!admin) return json({ error: "not found" }, { status: 404 });
  return json({ ok: true, admin });
}

/* ---------------- PUT ---------------- */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getAdminSession();
  if (!session) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const id = await getParamId(req, ctx);
  if (!id) return json({ error: "missing id" }, { status: 400 });

  const auth = await authorizeAdminMutation(session, id);
  if (!auth.ok) return auth.res!;

  const body = await req.json().catch(() => ({} as any));
  const name: string | null = (body?.name ?? "").toString().trim() || null;
  const role: AdminRole = body?.role === "ROOT" || body?.role === "FULL" || body?.role === "SCOPED"
    ? body.role
    : "SCOPED";

  const locationIds: string[] = Array.isArray(body?.locationIds)
    ? (body.locationIds as any[]).map(String).filter(Boolean)
    : [];

  // Validate role change
  if (role !== "SCOPED" && session.role !== "ROOT") {
    return json({ error: "Only ROOT can set ROOT/FULL" }, { status: 403 });
  }

  // Validate locationIds if SCOPED
  if (role === "SCOPED" && locationIds.length > 0) {
    const valid = await validateLocationIds(session, locationIds);
    if (!valid.valid) {
      return json({ error: valid.message }, { status: 400 });
    }

    // Ensure locations exist
    const existing = await getPrisma().location.findMany({
      where: { id: { in: locationIds } },
      select: { id: true },
    });
    const existingIds = existing.map((l) => l.id);
    const missing = locationIds.filter((id) => !existingIds.includes(id));
    if (missing.length > 0) {
      return json({ error: `Locations not found: ${missing.join(", ")}` }, { status: 400 });
    }
  }

  await getPrisma().$transaction(async (tx) => {
    await tx.admin.update({ where: { id }, data: { name, role } });
    await tx.adminLocation.deleteMany({ where: { adminId: id } });
    if (role === "SCOPED" && locationIds.length > 0) {
      await tx.adminLocation.createMany({
        data: locationIds.map((locId) => ({ adminId: id, locationId: locId })),
      });
    }
  });

  const admin = await getPrisma().admin.findUnique({
    where: { id },
    include: {
      locations: {
        include: { location: { select: { id: true, name: true, slug: true } } },
      },
    },
  });

  return json({ ok: true, admin });
}

/* ---------------- DELETE ---------------- */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getAdminSession();
  if (!session) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const id = await getParamId(req, ctx);
  if (!id) return json({ error: "missing id" }, { status: 400 });

  const auth = await authorizeAdminMutation(session, id);
  if (!auth.ok) return auth.res!;

  await getPrisma().adminLocation.deleteMany({ where: { adminId: id } });
  await getPrisma().admin.delete({ where: { id } });

  return json({ ok: true });
}