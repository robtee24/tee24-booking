// app/api/admin/admins/route.ts
//
//   GET  /api/admin/admins   — roster (SCOPED admins only see colleagues who
//                              share a location). Any signed-in admin.
//   POST /api/admin/admins   — create + invite. Requires `admin.manage`
//                              (ROOT/FULL). Only ROOT may create ROOT/FULL.
import { NextResponse, type NextRequest } from "next/server";
import type { AdminRole } from "@prisma/client";
import { requireAdminApi, requireFullAdminApi } from "@/lib/api-auth";
import { getActorContext } from "@/lib/actor";
import { assertCan } from "@/lib/permissions";
import {
  createStaffAdmin,
  listStaffAdmins,
  PERMISSION_PRESETS,
  permissionGroups,
  StaffError,
} from "@/services/staff.service";
import { staffApiError } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ROLES: AdminRole[] = ["ROOT", "FULL", "SCOPED"];

export async function GET(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  try {
    const admin = guard.admin;
    const admins =
      admin.role === "SCOPED"
        ? await listStaffAdmins({ locationIds: admin.locations.map((l) => l.locationId) })
        : await listStaffAdmins();

    const includeCatalog = req.nextUrl.searchParams.get("catalog") === "1";
    return NextResponse.json({
      ok: true,
      admins,
      ...(includeCatalog ? { groups: permissionGroups(), presets: PERMISSION_PRESETS } : {}),
    });
  } catch (err) {
    return staffApiError(err);
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireFullAdminApi();
  if (!guard.ok) return guard.response;
  try {
    assertCan(await getActorContext(), "admin.manage");
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const role: AdminRole = ALLOWED_ROLES.includes(body.role as AdminRole) ? (body.role as AdminRole) : "SCOPED";
    if (role !== "SCOPED" && guard.admin.role !== "ROOT") {
      throw new StaffError("Only ROOT can create ROOT/FULL admins", 403);
    }
    if (!body.phone) throw new StaffError("Phone is required", 400);

    const admin = await createStaffAdmin(
      {
        name: (body.name as string | null | undefined) ?? null,
        phone: String(body.phone),
        email: (body.email as string | null | undefined) ?? null,
        role,
        locationIds: Array.isArray(body.locationIds) ? (body.locationIds as string[]) : [],
        permissions: Array.isArray(body.permissions) ? (body.permissions as { permission: string; locationId?: string | null }[]) : [],
        sendInvite: body.sendInvite !== false,
      },
      guard.admin.id,
    );
    return NextResponse.json({ ok: true, admin }, { status: 201 });
  } catch (err) {
    return staffApiError(err);
  }
}
