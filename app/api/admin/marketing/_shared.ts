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

/**
 * Visitors (leads) are addressed by id in the URL but guarded by the location
 * in the query string. Make sure the lead actually belongs to that location so
 * a SCOPED admin can't read or edit another location's leads by swapping ids.
 * Returns a 404 response when out of scope (don't confirm the id exists).
 */
/**
 * Location IDs a marketing guard may touch: FULL/ROOT → null (unrestricted);
 * SCOPED → their assigned locations. Used to scope org-wide entities (referrals,
 * payouts) that only carry a member reference.
 */
export function guardLocationIds(g: Extract<MarketingGuard, { ok: true }>): string[] | null {
  const fullAccess = g.admin.role === "ROOT" || g.admin.role === "FULL";
  if (fullAccess) return null;
  return g.actor.locationIds ?? [g.location.id];
}

/**
 * 404 unless every given member belongs to a location the guard can manage.
 * FULL/ROOT always pass. Unknown member IDs are treated as out of scope.
 */
export async function requireMembersInScope(
  memberIds: Array<string | null | undefined>,
  g: Extract<MarketingGuard, { ok: true }>,
): Promise<NextResponse | null> {
  const ids = Array.from(new Set(memberIds.filter((x): x is string => typeof x === "string" && x.length > 0)));
  if (ids.length === 0) return null;
  const allowed = guardLocationIds(g);
  const rows = await getPrisma().member.findMany({ where: { id: { in: ids } }, select: { id: true, locationId: true } });
  if (rows.length !== ids.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (allowed === null) return null;
  const ok = rows.every((m) => m.locationId && allowed.includes(m.locationId));
  return ok ? null : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function requireLeadInScope(
  leadId: string,
  g: Extract<MarketingGuard, { ok: true }>,
): Promise<NextResponse | null> {
  const lead = await getPrisma().visitor.findUnique({ where: { id: leadId }, select: { locationId: true, organizationId: true } });
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const fullAccess = g.admin.role === "ROOT" || g.admin.role === "FULL";
  if (fullAccess) return null;
  const sameLocation = lead.locationId === g.location.id;
  const orgLeadInSameOrg = !lead.locationId && !!lead.organizationId && lead.organizationId === g.location.organizationId;
  if (sameLocation || orgLeadInSameOrg) return null;
  return NextResponse.json({ error: "Not found" }, { status: 404 });
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
