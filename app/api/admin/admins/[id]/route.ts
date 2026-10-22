// app/api/admin/admins/[id]/route.ts
//
//   GET    — one admin incl. locations + permission grants. ROOT/FULL, or a
//            SCOPED admin sharing a location.
//   PATCH  — update name/email/phone/role/locations/permissions. `admin.manage`.
//            FULL may only edit SCOPED admins; nobody edits themselves here.
//   PUT    — alias of PATCH (legacy clients).
//   DELETE — remove admin. Same rules as PATCH.
import { NextResponse } from "next/server";
import type { AdminRole } from "@prisma/client";
import { requireAdminApi } from "@/lib/api-auth";
import { getActorContext } from "@/lib/actor";
import { assertCan } from "@/lib/permissions";
import { deleteStaffAdmin, getStaffAdmin, StaffError, updateStaffAdmin } from "@/services/staff.service";
import { paramId, staffApiError } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function authorizeMutation(actorRole: AdminRole, actorId: string, targetId: string) {
  if (actorId === targetId) throw new StaffError("Use the account page to edit your own profile", 403);
  const target = await getStaffAdmin(targetId);
  if (!target) throw new StaffError("Admin not found", 404);
  if (actorRole === "FULL" && target.role !== "SCOPED") throw new StaffError("Only ROOT can modify ROOT/FULL admins", 403);
  return target;
}

export async function GET(_req: Request, ctx: Ctx) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  try {
    const id = await paramId(ctx);
    const admin = await getStaffAdmin(id);
    if (!admin) throw new StaffError("Admin not found", 404);
    if (guard.admin.role === "SCOPED") {
      const mine = new Set(guard.admin.locations.map((l) => l.locationId));
      const shares = admin.locations.some((l) => mine.has(l.locationId));
      if (!shares && admin.id !== guard.admin.id) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ ok: true, admin });
  } catch (err) {
    return staffApiError(err);
  }
}

async function update(req: Request, ctx: Ctx) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  try {
    assertCan(await getActorContext(), "admin.manage");
    const id = await paramId(ctx);
    await authorizeMutation(guard.admin.role, guard.admin.id, id);
    const body = await req.json().catch(() => ({} as Record<string, unknown>));

    let role: AdminRole | undefined;
    if (body.role !== undefined) {
      if (!["ROOT", "FULL", "SCOPED"].includes(String(body.role))) throw new StaffError("Invalid role", 400);
      role = body.role as AdminRole;
      if (role !== "SCOPED" && guard.admin.role !== "ROOT") throw new StaffError("Only ROOT can grant ROOT/FULL", 403);
    }

    const admin = await updateStaffAdmin(
      id,
      {
        name: body.name === undefined ? undefined : ((body.name as string | null) ?? null),
        email: body.email === undefined ? undefined : ((body.email as string | null) ?? null),
        phone: body.phone === undefined ? undefined : String(body.phone),
        role,
        locationIds: Array.isArray(body.locationIds) ? (body.locationIds as string[]) : undefined,
        permissions: Array.isArray(body.permissions) ? (body.permissions as { permission: string; locationId?: string | null }[]) : undefined,
      },
      guard.admin.id,
    );
    return NextResponse.json({ ok: true, admin });
  } catch (err) {
    return staffApiError(err);
  }
}

export const PATCH = update;
export const PUT = update;

export async function DELETE(_req: Request, ctx: Ctx) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  try {
    assertCan(await getActorContext(), "admin.manage");
    const id = await paramId(ctx);
    await authorizeMutation(guard.admin.role, guard.admin.id, id);
    await deleteStaffAdmin(id, guard.admin.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return staffApiError(err);
  }
}
