// /api/admin/mobile/push — send a push notification from the admin to members of a location.
//   GET  ?locationId=                      → how many members at the location can receive push
//   POST { locationId, title?, body, url?, memberId? }
//        → sends to every push-capable member at the location (or just `memberId`)
//
// Goes through `deliverPush` so each send lands in the Message ledger with
// channel PUSH, dead tokens get disabled, and the org pushEnabled gate is
// honoured. Quiet hours are skipped (force) — the admin is choosing when to send.
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { canAccessLocation } from "@/lib/access";
import { getPrisma } from "@/lib/db";
import { deliverPush } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUSH_DEVICE_WHERE = { revokedAt: null, pushEnabled: true, pushToken: { not: null } } as const;
const MAX_TITLE = 60;
const MAX_BODY = 500;

type Ctx = Awaited<ReturnType<typeof requireAdminApi>>;

function locationAllowed(guard: Extract<Ctx, { ok: true }>, locationId: string) {
  return canAccessLocation(guard.admin.role, guard.admin.locations.map((l) => l.locationId), locationId);
}

/** Distinct members at a location with at least one push-capable device. */
async function pushMembers(locationId: string, memberId?: string | null) {
  const rows = await getPrisma().memberDevice.findMany({
    where: { ...PUSH_DEVICE_WHERE, member: { locationId, mergedIntoId: null, ...(memberId ? { id: memberId } : {}) } },
    select: { memberId: true },
    distinct: ["memberId"],
  });
  return rows.map((r) => r.memberId);
}

export async function GET(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  const locationId = req.nextUrl.searchParams.get("locationId")?.trim();
  if (!locationId) return NextResponse.json({ ok: false, error: "locationId required" }, { status: 400 });
  if (!locationAllowed(guard, locationId)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const memberIds = await pushMembers(locationId);
  const [devices, members] = await Promise.all([
    getPrisma().memberDevice.count({ where: { ...PUSH_DEVICE_WHERE, member: { locationId, mergedIntoId: null } } }),
    getPrisma().member.count({ where: { locationId, mergedIntoId: null, status: { in: ["ACTIVE", "FROZEN", "PENDING"] } } }),
  ]);
  return NextResponse.json({ ok: true, reachable: memberIds.length, devices, members });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as { locationId?: string; title?: string; body?: string; url?: string; memberId?: string };
    const locationId = String(body.locationId ?? "").trim();
    const text = String(body.body ?? "").trim();
    const title = String(body.title ?? "").trim();
    const url = String(body.url ?? "").trim();
    const memberId = body.memberId ? String(body.memberId).trim() : null;

    if (!locationId) return NextResponse.json({ ok: false, error: "Pick a location" }, { status: 400 });
    if (!text) return NextResponse.json({ ok: false, error: "Message is required" }, { status: 400 });
    if (text.length > MAX_BODY) return NextResponse.json({ ok: false, error: `Message must be ${MAX_BODY} characters or fewer` }, { status: 400 });
    if (title.length > MAX_TITLE) return NextResponse.json({ ok: false, error: `Title must be ${MAX_TITLE} characters or fewer` }, { status: 400 });
    if (url && !url.startsWith("/(tabs)")) return NextResponse.json({ ok: false, error: "Link must be an in-app path starting with /(tabs)" }, { status: 400 });
    if (!locationAllowed(guard, locationId)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    const location = await getPrisma().location.findUnique({ where: { id: locationId }, select: { id: true, name: true, organizationId: true, timezone: true } });
    if (!location) return NextResponse.json({ ok: false, error: "Location not found" }, { status: 404 });

    const memberIds = await pushMembers(locationId, memberId);
    if (memberIds.length === 0) {
      return NextResponse.json({ ok: false, error: memberId ? "That member doesn't have push notifications on" : "Nobody at this location has the app with notifications on yet" }, { status: 400 });
    }

    const data: Record<string, unknown> = { type: "admin", locationId, ...(url ? { url } : {}) };
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];
    // Modest concurrency: Expo batches internally, but deliverPush is per-member (ledger + device lookup).
    const CONCURRENCY = 10;
    for (let i = 0; i < memberIds.length; i += CONCURRENCY) {
      const chunk = memberIds.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        chunk.map((id) =>
          deliverPush({
            memberId: id,
            title: title || null,
            body: text,
            data,
            category: "MARKETING",
            organizationId: location.organizationId,
            timeZone: location.timezone,
            force: true,
            ledger: { memberId: id, locationId, category: "MARKETING", source: "admin.push" },
          }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) })),
        ),
      );
      for (const r of results) {
        if (r.ok) sent++;
        else {
          failed++;
          if (r.error && errors.length < 3 && !errors.includes(r.error)) errors.push(r.error);
        }
      }
    }

    console.log("[admin/mobile/push]", { adminId: guard.admin.id, locationId, targeted: memberIds.length, sent, failed, single: !!memberId });
    return NextResponse.json({ ok: sent > 0, targeted: memberIds.length, sent, failed, errors, location: location.name });
  } catch (err) {
    console.error("[admin/mobile/push]", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Server error" }, { status: 500 });
  }
}
