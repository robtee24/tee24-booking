// /api/admin/notifications/inbox — the admin's own alert inbox.
//   GET  ?tab=unread|all|snoozed&cursor=&take=   → { items, nextCursor, unread }
//   POST { action: "mark-all-read" }
//        { action: "mark-read", ids: string[] }
//        { action: "snooze", ids: string[], hours?: number }   (default 24h)
// Any authenticated admin; SCOPED admins only see/affect rows for their locations.
import { NextResponse, type NextRequest } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import {
  countUnreadNotifications,
  listInbox,
  markAllNotificationsRead,
  markNotificationsRead,
  snoozeNotifications,
  type InboxScope,
  type InboxTab,
} from "@/services/staff.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function scopeOf(admin: { role: InboxScope["role"]; locations: { locationId: string }[] }): InboxScope {
  return { role: admin.role, locationIds: admin.locations.map((l) => l.locationId) };
}

export async function GET(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  const scope = scopeOf(guard.admin);
  const sp = req.nextUrl.searchParams;
  const tabRaw = sp.get("tab");
  const tab: InboxTab = tabRaw === "all" || tabRaw === "snoozed" ? tabRaw : "unread";
  const take = Number(sp.get("take") ?? 50);
  const cursor = sp.get("cursor");
  const [page, unread] = await Promise.all([
    listInbox(scope, { tab, take: Number.isFinite(take) ? take : 50, cursor }),
    countUnreadNotifications(scope),
  ]);
  return NextResponse.json({ ok: true, tab, unread, ...page });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  const scope = scopeOf(guard.admin);
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = String(body.action ?? "");
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean).slice(0, 500) : [];

  let affected = 0;
  if (action === "mark-all-read") affected = await markAllNotificationsRead(scope);
  else if (action === "mark-read") affected = await markNotificationsRead(scope, ids);
  else if (action === "snooze") {
    const hours = Math.min(Math.max(Number(body.hours ?? 24), 1), 24 * 30);
    affected = await snoozeNotifications(scope, ids, new Date(Date.now() + hours * 3600_000));
  } else return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });

  const unread = await countUnreadNotifications(scope);
  return NextResponse.json({ ok: true, affected, unread });
}
