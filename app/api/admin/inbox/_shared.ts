/**
 * Org-wide inbox API guard. Unlike the marketing routes (which are scoped to a
 * single `?slug=`), these accept an optional `locationId` and otherwise cover
 * every location the admin can access.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi, forbidden, type ApiAdmin } from "@/lib/api-auth";
import { canAccessLocation, isFullAccess } from "@/lib/access";
import { getPrisma } from "@/lib/db";

export type InboxGuard =
  | { ok: false; response: NextResponse }
  | {
      ok: true;
      admin: ApiAdmin;
      /** undefined = all locations (full access); otherwise the allowed set. */
      locationIds: string[] | undefined;
    };

export async function guardInbox(req: NextRequest): Promise<InboxGuard> {
  const g = await requireAdminApi();
  if (!g.ok) return { ok: false, response: g.response };
  const admin = g.admin;
  const adminLocIds = admin.locations.map((l) => l.locationId);
  const requested = req.nextUrl.searchParams.get("locationId") || null;
  if (requested) {
    if (!canAccessLocation(admin.role, adminLocIds, requested)) return { ok: false, response: forbidden() };
    return { ok: true, admin, locationIds: [requested] };
  }
  return { ok: true, admin, locationIds: isFullAccess(admin.role) ? undefined : adminLocIds };
}

/** Can this guard see the conversation (by its own or its member's location)? */
export async function conversationVisible(conversationId: string, locationIds: string[] | undefined): Promise<boolean> {
  if (!locationIds) return true;
  const c = await getPrisma().conversation.findUnique({
    where: { id: conversationId },
    select: { locationId: true, member: { select: { locationId: true } } },
  });
  if (!c) return false;
  const loc = c.member?.locationId ?? c.locationId;
  // Conversations with no location at all (unknown email sender) are visible to everyone who can see the inbox.
  return !loc || locationIds.includes(loc);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJson(req: NextRequest): Promise<Record<string, any>> {
  try {
    return (await req.json()) ?? {};
  } catch {
    return {};
  }
}

export function apiError(e: unknown, status = 400) {
  const message = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: message }, { status });
}
