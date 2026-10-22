// lib/api-auth.ts
// Route-level auth guards for /api/admin/*. The middleware also blocks these
// paths without a session, but every handler must still check (defense in depth
// and location scoping for SCOPED admins).
import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { canAccessLocation, getCurrentAdmin } from "@/lib/access";

export type ApiAdmin = NonNullable<Awaited<ReturnType<typeof getCurrentAdmin>>>;

type Guard =
  | { ok: true; admin: ApiAdmin; response?: undefined }
  | { ok: false; admin?: undefined; response: NextResponse };

export function unauthorized(message = "Unauthorized") {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden(message = "Forbidden") {
  return NextResponse.json({ error: message }, { status: 403 });
}

/** Require a signed-in admin. */
export async function requireAdminApi(): Promise<Guard> {
  const admin = await getCurrentAdmin();
  if (!admin) return { ok: false, response: unauthorized() };
  return { ok: true, admin };
}

/**
 * Require a signed-in admin who can manage the given location (by id or slug).
 * Resolves the location so handlers don't need a second lookup.
 */
export async function requireLocationAdminApi(ref: { locationId?: string | null; locationSlug?: string | null }) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard as Guard & { location?: undefined };

  const where = ref.locationId ? { id: ref.locationId } : ref.locationSlug ? { slug: ref.locationSlug } : null;
  if (!where) {
    return { ok: false as const, response: NextResponse.json({ error: "Missing location" }, { status: 400 }) };
  }
  const location = await getPrisma().location.findUnique({ where, select: { id: true, slug: true, name: true } });
  if (!location) return { ok: false as const, response: NextResponse.json({ error: "Location not found" }, { status: 404 }) };

  const ids = guard.admin.locations.map((l) => l.locationId);
  if (!canAccessLocation(guard.admin.role, ids, location.id)) return { ok: false as const, response: forbidden() };

  return { ok: true as const, admin: guard.admin, location };
}

/** Require ROOT or FULL role. */
export async function requireFullAdminApi(): Promise<Guard> {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard;
  if (guard.admin.role === "SCOPED") return { ok: false, response: forbidden() };
  return guard;
}
