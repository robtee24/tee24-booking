// app/api/admin/admins/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { getAdminSession, isRoot } from "@/lib/session.server";
import type { AdminRole } from "@prisma/client";

export const runtime = "nodejs";

/* ---------------- utils ---------------- */
function normalizePhone(input: string): string {
  const digits = (input || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

const ALLOWED_ROLES: AdminRole[] = ["ROOT", "FULL", "SCOPED"];

/* ---------------- GET /api/admin/admins ---------------- */
export async function GET(_request: NextRequest) {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    let admins;

    if (session.role === "SCOPED" && session.locationSlugs?.length) {
      // SCOPED: only admins who share at least one location
      const adminIdsInScope = await getPrisma().adminLocation.findMany({
        where: {
          location: { slug: { in: session.locationSlugs } },
        },
        select: { adminId: true },
        distinct: ["adminId"],
      });

      const ids = adminIdsInScope.map((a) => a.adminId);

      admins = await getPrisma().admin.findMany({
        where: { id: { in: ids } },
        orderBy: { createdAt: "desc" },
        include: {
          locations: {
            include: { location: { select: { id: true, name: true, slug: true } } },
          },
        },
      });
    } else {
      // ROOT / FULL: see all
      admins = await getPrisma().admin.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          locations: {
            include: { location: { select: { id: true, name: true, slug: true } } },
          },
        },
      });
    }

    return NextResponse.json({ ok: true, admins });
  } catch (err: any) {
    console.error("GET /api/admin/admins error:", err?.message || err);
    return NextResponse.json({ ok: false, error: "server error" }, { status: 500 });
  }
}

/* ---------------- POST /api/admin/admins ---------------- */
export async function POST(request: NextRequest) {
  try {
    const session = await getAdminSession();
    if (!session || !isRoot(session)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({} as any));
    let { name, phone, role, locationIds } = body as {
      name?: string | null;
      phone?: string;
      role?: AdminRole;
      locationIds?: string[];
    };

    const cleanName = (name ?? "").toString().trim() || null;
    const cleanPhone = normalizePhone(phone || "");
    if (!cleanPhone) {
      return NextResponse.json({ ok: false, error: "Invalid phone" }, { status: 400 });
    }

    const cleanRole: AdminRole = ALLOWED_ROLES.includes(role as AdminRole)
      ? (role as AdminRole)
      : "SCOPED";

    // Ensure uniqueness by phone
    const exists = await getPrisma().admin.findUnique({ where: { phone: cleanPhone } });
    if (exists) {
      return NextResponse.json({ ok: false, error: "Admin already exists" }, { status: 400 });
    }

    // Validate locationIds if SCOPED
    let uniqueLocIds: string[] = [];
    if (cleanRole === "SCOPED" && Array.isArray(locationIds) && locationIds.length) {
      uniqueLocIds = Array.from(new Set(locationIds.map(String).filter(Boolean)));

      // ROOT can assign any location — no restriction
      // But we still validate that location IDs exist
      const validLocations = await getPrisma().location.findMany({
        where: { id: { in: uniqueLocIds } },
        select: { id: true },
      });
      const validIds = validLocations.map((l) => l.id);
      const invalid = uniqueLocIds.filter((id) => !validIds.includes(id));
      if (invalid.length > 0) {
        return NextResponse.json(
          { ok: false, error: `Invalid location IDs: ${invalid.join(", ")}` },
          { status: 400 }
        );
      }
    }

    const data: any = {
      phone: cleanPhone,
      role: cleanRole,
      name: cleanName,
    };

    if (cleanRole === "SCOPED" && uniqueLocIds.length > 0) {
      data.locations = { create: uniqueLocIds.map((id) => ({ locationId: id })) };
    }

    const admin = await getPrisma().admin.create({
      data,
      include: {
        locations: {
          include: { location: { select: { id: true, name: true, slug: true } } },
        },
      },
    });

    return NextResponse.json({ ok: true, admin });
  } catch (err: any) {
    console.error("POST /api/admin/admins error:", err?.message || err);
    return NextResponse.json({ ok: false, error: "server error" }, { status: 500 });
  }
}