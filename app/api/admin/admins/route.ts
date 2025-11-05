// app/api/admin/admins/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAdminSession, isRoot } from "@/lib/session";
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

    const admins = await prisma.admin.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        locations: {
          include: { location: { select: { id: true, name: true, slug: true } } },
        },
      },
    });

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
    const exists = await prisma.admin.findUnique({ where: { phone: cleanPhone } });
    if (exists) {
      return NextResponse.json({ ok: false, error: "Admin already exists" }, { status: 400 });
    }

    // If SCOPED and locationIds provided, ensure they are unique/defined
    const uniqueLocIds =
      Array.isArray(locationIds) && locationIds.length
        ? Array.from(new Set(locationIds.map(String)))
        : [];

    const data: any = {
      phone: cleanPhone,
      role: cleanRole,
      name: cleanName, // nullable allowed
    };

    if (cleanRole === "SCOPED" && uniqueLocIds.length > 0) {
      data.locations = { create: uniqueLocIds.map((id) => ({ locationId: id })) };
    }

    const admin = await prisma.admin.create({
      data,
      include: {
        locations: { include: { location: { select: { id: true, name: true, slug: true } } } },
      },
    });

    return NextResponse.json({ ok: true, admin });
  } catch (err: any) {
    console.error("POST /api/admin/admins error:", err?.message || err);
    return NextResponse.json({ ok: false, error: "server error" }, { status: 500 });
  }
}


