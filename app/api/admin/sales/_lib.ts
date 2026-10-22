// app/api/admin/sales/_lib.ts
// Shared guard + error mapping for the POS API routes (sales, products, gift cards).
import { NextResponse, type NextRequest } from "next/server";
import { requireLocationAdminApi } from "@/lib/api-auth";
import { getActorContext } from "@/lib/actor";
import { assertCan, ForbiddenError, type Permission } from "@/lib/permissions";
import { getPosLocation, PosError } from "@/services/pos.service";

export type PosGuard =
  | { ok: true; admin: { id: string; role: string }; location: Awaited<ReturnType<typeof getPosLocation>> }
  | { ok: false; response: NextResponse };

/**
 * Resolve `locationSlug` (query or body), enforce location access and —
 * when `permission` is given — the RBAC permission for mutations.
 */
export async function guardPos(req: NextRequest, opts: { permission?: Permission; body?: Record<string, unknown> | null } = {}): Promise<PosGuard> {
  const slug = req.nextUrl.searchParams.get("locationSlug") || (typeof opts.body?.locationSlug === "string" ? (opts.body.locationSlug as string) : null);
  if (!slug) return { ok: false, response: NextResponse.json({ error: "locationSlug is required" }, { status: 400 }) };
  const guard = await requireLocationAdminApi({ locationSlug: slug });
  if (!guard.ok || !guard.location) return { ok: false, response: guard.ok ? NextResponse.json({ error: "Location not found" }, { status: 404 }) : guard.response };
  try {
    const location = await getPosLocation({ id: guard.location.id });
    if (opts.permission) assertCan(await getActorContext(), opts.permission, { locationId: location.id, organizationId: location.organizationId });
    return { ok: true, admin: { id: guard.admin.id, role: guard.admin.role }, location };
  } catch (e) {
    return { ok: false, response: posErrorResponse(e) };
  }
}

export function posErrorResponse(e: unknown): NextResponse {
  if (e instanceof ForbiddenError) return NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 });
  if (e instanceof PosError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error("[pos-api]", e);
  return NextResponse.json({ error: e instanceof Error ? e.message : "Server error" }, { status: 500 });
}

export async function readJson<T = Record<string, unknown>>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

export function csvResponse(csv: string, filename: string): NextResponse {
  return new NextResponse(csv, {
    status: 200,
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
  });
}
