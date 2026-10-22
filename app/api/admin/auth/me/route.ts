// /api/admin/auth/me — the signed-in admin's own account.
//   GET            → { admin: { id, name, email, phone, role, twoFactorEnabled, hasPin, inviteStatus, lastLoginAt } }
//   PATCH { name?, email? }  → update own profile (role/phone are managed by ROOT/FULL via /api/admin/admins/[id]).
import { NextResponse, type NextRequest } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { normalizeEmail, StaffError } from "@/services/staff.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  twoFactorEnabled: true,
  frontDeskPinHash: true,
  inviteStatus: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

function shape(a: { frontDeskPinHash: string | null } & Record<string, unknown>) {
  const { frontDeskPinHash, ...rest } = a;
  return { ...rest, hasPin: !!frontDeskPinHash };
}

export async function GET() {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  const row = await getPrisma().admin.findUnique({ where: { id: guard.admin.id }, select: SELECT });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, admin: shape(row) });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const data: { name?: string | null; email?: string | null } = {};
    if (body.name !== undefined) data.name = String(body.name ?? "").trim() || null;
    if (body.email !== undefined) {
      const email = normalizeEmail(body.email);
      if (email) {
        const dup = await getPrisma().admin.findUnique({ where: { email }, select: { id: true } });
        if (dup && dup.id !== guard.admin.id) throw new StaffError("That email is already used by another admin", 409);
      }
      data.email = email;
    }
    const before = await getPrisma().admin.findUnique({ where: { id: guard.admin.id }, select: { name: true, email: true } });
    const row = await getPrisma().admin.update({ where: { id: guard.admin.id }, data, select: SELECT });
    void audit({
      actorId: guard.admin.id,
      actorRole: guard.admin.role,
      action: "admin.update",
      entityType: "Admin",
      entityId: guard.admin.id,
      before,
      after: data,
      metadata: { self: true },
    });
    return NextResponse.json({ ok: true, admin: shape(row) });
  } catch (err) {
    if (err instanceof StaffError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    console.error("[auth/me] PATCH", err);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
