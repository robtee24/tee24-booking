// app/api/admin/admins/[id]/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { getAdminSession, isRoot } from "@/lib/session.server";

type AdminRole = "ROOT" | "FULL" | "SCOPED";

/* ---------------- helpers ---------------- */

function json(data: any, init?: number | ResponseInit) {
  return NextResponse.json(data, init as any);
}

function devBypass(req: Request): boolean {
  const hdr = req.headers.get("x-dev-root");
  const secret = process.env.CRON_SECRET || "";
  return !!hdr && !!secret && hdr === secret;
}

function cleanRole(v: any): AdminRole {
  return v === "ROOT" || v === "FULL" || v === "SCOPED" ? v : "SCOPED";
}

/** Robustly pull :id out of ctx.params (Promise in newer Next) or fall back to URL path */
async function getParamId(
  req: Request,
  ctx?: { params?: Promise<{ id?: string | string[] }> }
): Promise<string> {
  // Prefer params from ctx (Next.js canonical source)
  let raw: string | string[] | undefined;
  if (ctx?.params) {
    const p = await ctx.params;
    raw = p?.id;
  }

  // Fallback: parse from request URL path if needed
  if (!raw) {
    const match = new URL(req.url)
      .pathname.match(/\/api\/admin\/admins\/([^/?#]+)/);
    raw = match?.[1];
  }

  if (!raw) return "";
  const id = Array.isArray(raw) ? raw[0] : raw;
  return decodeURIComponent(String(id));
}

async function requireRoot(req: Request) {
  const session = await getAdminSession();
  if (!session && !devBypass(req)) {
    return { ok: false as const, res: json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (session && !isRoot(session)) {
    return { ok: false as const, res: json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true as const };
}

/* ---------------- GET ---------------- */

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const guard = await requireRoot(req);
  if (!guard.ok) return guard.res;

  const id = await getParamId(req, ctx);
  if (!id) return json({ error: "missing id" }, { status: 400 });

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
  const guard = await requireRoot(req);
  if (!guard.ok) return guard.res;

  const id = await getParamId(req, ctx);
  if (!id) return json({ error: "missing id" }, { status: 400 });

  const body = await req.json().catch(() => ({} as any));
  const name: string | null = (body?.name ?? "").toString().trim() || null;
  const role: AdminRole = cleanRole(body?.role);
  const locationIds: string[] = Array.isArray(body?.locationIds)
    ? (body.locationIds as any[]).map((x) => String(x)).filter(Boolean)
    : [];

  const exists = await getPrisma().admin.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return json({ error: "not found" }, { status: 404 });

  await getPrisma().$transaction(async (tx) => {
    await tx.admin.update({ where: { id }, data: { name, role } });
    // reset links
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
  const guard = await requireRoot(req);
  if (!guard.ok) return guard.res;

  const id = await getParamId(req, ctx);
  if (!id) return json({ error: "missing id" }, { status: 400 });

  await getPrisma().adminLocation.deleteMany({ where: { adminId: id } });
  await getPrisma().admin.delete({ where: { id } });

  return json({ ok: true });
}


