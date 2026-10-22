// Shared guard for comms/marketing admin API routes.
// Resolves the location from `?slug=` (or body.locationSlug / body.locationId),
// authenticates the admin, and checks the permission against that location.
import { NextRequest, NextResponse } from "next/server";
import { requireLocationAdminApi } from "@/lib/api-auth";
import { getActorContext } from "@/lib/actor";
import { assertCan, ForbiddenError, type Permission } from "@/lib/permissions";
import { getPrisma } from "@/lib/db";

export type MarketingGuard =
  | { ok: true; admin: { id: string; role: string; phone: string; name: string | null; email: string | null }; location: { id: string; slug: string; name: string; organizationId: string | null; timezone: string }; actor: NonNullable<Awaited<ReturnType<typeof getActorContext>>> }
  | { ok: false; response: NextResponse };

export async function guardMarketing(
  req: NextRequest,
  permission: Permission | Permission[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  opts?: { body?: Record<string, any> | null; slug?: string | null },
): Promise<MarketingGuard> {
  const slug = opts?.slug ?? req.nextUrl.searchParams.get("slug") ?? opts?.body?.locationSlug ?? null;
  const locationId = req.nextUrl.searchParams.get("locationId") ?? opts?.body?.locationId ?? null;
  const g = await requireLocationAdminApi(slug ? { locationSlug: slug } : { locationId });
  if (!g.ok) return { ok: false, response: g.response };
  if (!g.location) return { ok: false, response: NextResponse.json({ error: "Location not found" }, { status: 404 }) };
  const locationIdResolved = g.location.id;
  const actor = await getActorContext();
  if (!actor) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  try {
    const perms = Array.isArray(permission) ? permission : [permission];
    // Any-of semantics: the actor needs at least one of the listed permissions.
    let okAny = false;
    let lastErr: unknown = null;
    for (const p of perms) {
      try {
        assertCan(actor, p, { locationId: locationIdResolved });
        okAny = true;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!okAny) throw lastErr ?? new ForbiddenError(perms[0]);
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, response: NextResponse.json({ error: e.message }, { status: 403 }) };
    throw e;
  }
  const [loc, adminRow] = await Promise.all([
    getPrisma().location.findUnique({ where: { id: locationIdResolved }, select: { id: true, slug: true, name: true, organizationId: true, timezone: true } }),
    getPrisma().admin.findUnique({ where: { id: g.admin.id }, select: { email: true } }),
  ]);
  if (!loc) return { ok: false, response: NextResponse.json({ error: "Location not found" }, { status: 404 }) };
  return {
    ok: true,
    admin: { id: g.admin.id, role: g.admin.role, phone: g.admin.phone, name: g.admin.name, email: adminRow?.email ?? null },
    location: loc,
    actor,
  };
}

export function apiError(e: unknown, status = 400) {
  const msg = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: msg }, { status: e instanceof ForbiddenError ? 403 : status });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJson<T = any>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
