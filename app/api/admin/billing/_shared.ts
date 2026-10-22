// Shared guards/helpers for billing-owned admin API routes.
import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { requireLocationAdminApi } from "@/lib/api-auth";
import { getActorContext } from "@/lib/actor";
import { assertCan, ForbiddenError, type Permission } from "@/lib/permissions";
import { ENV } from "@/lib/env";
import { getSquareConnectionStatus, type SquareConnectionStatus } from "@/lib/square";

export type SquareStatus = SquareConnectionStatus;

/** Square connection status for one location (never includes secrets). */
export function squareStatusPayload(locationId: string): Promise<SquareStatus> {
  return getSquareConnectionStatus(locationId, ENV.APP_BASE_URL);
}

export type BillingGuard =
  | { ok: true; admin: NonNullable<Awaited<ReturnType<typeof requireLocationAdminApi>>["admin"]>; location: { id: string; slug: string; name: string }; actorId: string }
  | { ok: false; response: NextResponse };

/**
 * Authenticate the admin, resolve + authorise the location, and assert the
 * permission in one call. Pass either a slug or an id.
 */
export async function guardBilling(
  ref: { locationSlug?: string | null; locationId?: string | null },
  permission: Permission,
): Promise<BillingGuard> {
  const guard = await requireLocationAdminApi(ref);
  if (!guard.ok) return { ok: false, response: guard.response };
  const location = guard.location;
  if (!location) return { ok: false, response: NextResponse.json({ error: "Location not found" }, { status: 404 }) };
  try {
    const actor = await getActorContext();
    assertCan(actor, permission, { locationId: location.id });
  } catch (e) {
    return { ok: false, response: errorResponse(e) };
  }
  return { ok: true, admin: guard.admin, location, actorId: guard.admin.id };
}

/** Resolve an invoice's location so routes keyed by invoice id can be scoped. */
export async function guardInvoice(invoiceId: string, permission: Permission) {
  const inv = await getPrisma().invoice.findUnique({ where: { id: invoiceId }, select: { id: true, locationId: true } });
  if (!inv) return { ok: false as const, response: NextResponse.json({ error: "Invoice not found" }, { status: 404 }) };
  const g = await guardBilling({ locationId: inv.locationId }, permission);
  if (!g.ok) return g;
  return { ...g, invoiceId: inv.id };
}

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
  const message = e instanceof Error ? e.message : String(e);
  const status = /not found/i.test(message) ? 404 : 400;
  return NextResponse.json({ error: message }, { status });
}

export function parseDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function csvResponse(csv: string, filename: string): NextResponse {
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
