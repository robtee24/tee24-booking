// app/api/admin/admins/[id]/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAdminSession, isRoot } from "@/lib/session";

type AdminRole = "ROOT" | "FULL" | "SCOPED";

/* ---------------- helpers ---------------- */

function devBypass(req: NextRequest): boolean {
  const hdr = req.headers.get("x-dev-root");
  const secret = process.env.CRON_SECRET || "";
  return !!hdr && !!secret && hdr === secret;
}

function cleanRole(v: any): AdminRole {
  return v === "ROOT" || v === "FULL" || v === "SCOPED" ? v : "SCOPED";
}

/** Robustly pull :id out of either ctx.params or the URL path */
function getParamId(req: NextRequest, ctx?: { params?: { id?: string | string[] } }): string {
  const raw =
    (ctx?.params?.id as any) ??
    // Some Next setups expose params on the request (edge quirk)
    (req as any)?.params?.id ??
    // Last fallback: parse from path
    req.nextUrl.pathname.match(/\/api\/admin\/admins\/([^/?#]+)/)?.[1];

  if (!raw) return "";
  const id = Array.isArray(raw) ? raw[0] : raw;
  return decodeURIComponent(String(id));
}

/* ---------------- GET ---------------- */

export async function GET(req: NextRequest, ctx: { params?: { id?: string | string[] } }) {
  const id = getParamId(req, ctx);
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const session = await getAdminSession();
  if (!session && !devBypass(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (session && !isRoot(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = await prisma.admin.findUnique({
    where: { id },
    include: { locations: { include: { location: { select: { id: true, name: true, slug: true } } } } },
  });
  if (!admin) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ ok: true, admin });
}

/* ---------------- PUT ---------------- */

export async function PUT(req: NextRequest, ctx: { params?: { id?: string | string[] } }) {
  const id = getParamId(req, ctx);
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const session = await getAdminSession();
  if (!session && !devBypass(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (session && !isRoot(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({} as any));
  const name: string | null = (body?.name ?? "").toString().trim() || null;
  const role: AdminRole = cleanRole(body?.role);
  const locationIds: string[] = Array.isArray(body?.locationIds)
    ? (body.locationIds as any[]).map((x) => String(x)).filter(Boolean)
    : [];

  const exists = await prisma.admin.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.admin.update({ where: { id }, data: { name, role } });
    // reset links
    await tx.adminLocation.deleteMany({ where: { adminId: id } });
    if (role === "SCOPED" && locationIds.length > 0) {
      await tx.adminLocation.createMany({
        data: locationIds.map((locId) => ({ adminId: id, locationId: locId })),
      });
    }
  });

  const admin = await prisma.admin.findUnique({
    where: { id },
    include: { locations: { include: { location: { select: { id: true, name: true, slug: true } } } } },
  });

  return NextResponse.json({ ok: true, admin });
}

/* ---------------- DELETE ---------------- */

export async function DELETE(req: NextRequest, ctx: { params?: { id?: string | string[] } }) {
  const id = getParamId(req, ctx);
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const session = await getAdminSession();
  if (!session && !devBypass(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (session && !isRoot(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await prisma.adminLocation.deleteMany({ where: { adminId: id } });
  await prisma.admin.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}


