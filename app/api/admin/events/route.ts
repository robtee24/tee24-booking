// /api/admin/events — events shown in the member app (league play, clinics, socials).
//   GET    ?locationId=            → events for a location (plus org-wide ones)
//   POST   { locationId|null, title, description?, kind, startsAt, endsAt?, scheduleNote?, imageUrl?, ctaLabel?, ctaUrl?, leagueId?, capacity?, published?, featured? }
//   PATCH  { id, ...fields }
//   DELETE { id }
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { canAccessLocation } from "@/lib/access";
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = ["LEAGUE", "CLINIC", "TOURNAMENT", "SOCIAL", "OTHER"] as const;

type Body = Partial<{
  id: string;
  locationId: string | null;
  title: string;
  description: string | null;
  kind: string;
  startsAt: string;
  endsAt: string | null;
  scheduleNote: string | null;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  leagueId: number | string | null;
  capacity: number | string | null;
  published: boolean;
  featured: boolean;
}>;

function clean(body: Body, partial: boolean) {
  const data: Record<string, unknown> = {};
  const str = (k: keyof Body, max: number, required = false) => {
    if (!(k in body)) {
      if (required && !partial) throw new Error(`${k} is required`);
      return;
    }
    const v = body[k];
    const s = typeof v === "string" ? v.trim().slice(0, max) : "";
    if (required && !s) throw new Error(`${k} is required`);
    data[k] = s || null;
  };
  str("title", 140, true);
  str("description", 4000);
  str("scheduleNote", 200);
  str("imageUrl", 1000);
  str("ctaLabel", 40);
  str("ctaUrl", 1000);
  if (data.title === null) throw new Error("title is required");
  if ("kind" in body) {
    if (!KINDS.includes(body.kind as (typeof KINDS)[number])) throw new Error("invalid kind");
    data.kind = body.kind;
  }
  if ("startsAt" in body || !partial) {
    const d = new Date(body.startsAt ?? "");
    if (Number.isNaN(d.getTime())) throw new Error("startsAt is invalid");
    data.startsAt = d;
  }
  if ("endsAt" in body) {
    if (!body.endsAt) data.endsAt = null;
    else {
      const d = new Date(body.endsAt);
      if (Number.isNaN(d.getTime())) throw new Error("endsAt is invalid");
      data.endsAt = d;
    }
  }
  if ("leagueId" in body) {
    const n = body.leagueId === null || body.leagueId === "" ? null : Number(body.leagueId);
    if (n != null && (!Number.isInteger(n) || n <= 0)) throw new Error("leagueId is invalid");
    data.leagueId = n;
  }
  if ("capacity" in body) {
    const n = body.capacity === null || body.capacity === "" ? null : Number(body.capacity);
    if (n != null && (!Number.isInteger(n) || n <= 0)) throw new Error("capacity is invalid");
    data.capacity = n;
  }
  if ("published" in body) data.published = Boolean(body.published);
  if ("featured" in body) data.featured = Boolean(body.featured);
  if ("locationId" in body) data.locationId = body.locationId || null;
  return data;
}

function fail(err: unknown) {
  const msg = err instanceof Error ? err.message : "Server error";
  const known = /required|invalid|not found/i.test(msg);
  if (!known) console.error("[admin/events]", err);
  return NextResponse.json({ ok: false, error: msg }, { status: known ? 400 : 500 });
}

async function assertLocation(admin: { role: string; locations: { locationId: string }[] }, locationId: string | null | undefined) {
  if (!locationId) {
    if (admin.role === "SCOPED") throw new Error("Only full admins can create org-wide events");
    return;
  }
  const ids = admin.locations.map((l) => l.locationId);
  if (!canAccessLocation(admin.role as "ROOT" | "FULL" | "SCOPED", ids, locationId)) throw new Error("Forbidden: location not found");
}

export async function GET(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  const locationId = req.nextUrl.searchParams.get("locationId");
  const events = await getPrisma().event.findMany({
    where: locationId ? { OR: [{ locationId }, { locationId: null }] } : {},
    orderBy: { startsAt: "desc" },
    take: 200,
    include: { _count: { select: { rsvps: { where: { status: "GOING" } } } }, location: { select: { id: true, name: true, slug: true } } },
  });
  return NextResponse.json({ ok: true, events });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    await assertLocation(guard.admin, body.locationId);
    const data = clean(body, false);
    const event = await getPrisma().event.create({ data: { ...(data as { title: string; startsAt: Date }), createdById: guard.admin.id } });
    void audit({ actorId: guard.admin.id, actorRole: "ADMIN", action: "event.create", entityType: "Event", entityId: event.id, metadata: { locationId: event.locationId }, after: data });
    return NextResponse.json({ ok: true, event }, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    if (!body.id) throw new Error("id is required");
    const prisma = getPrisma();
    const existing = await prisma.event.findUnique({ where: { id: body.id } });
    if (!existing) throw new Error("Event not found");
    await assertLocation(guard.admin, existing.locationId);
    if ("locationId" in body) await assertLocation(guard.admin, body.locationId);
    const data = clean(body, true);
    const event = await prisma.event.update({ where: { id: body.id }, data });
    void audit({ actorId: guard.admin.id, actorRole: "ADMIN", action: "event.update", entityType: "Event", entityId: event.id, metadata: { locationId: event.locationId }, before: existing, after: data });
    return NextResponse.json({ ok: true, event });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const id = body.id ?? req.nextUrl.searchParams.get("id") ?? undefined;
    if (!id) throw new Error("id is required");
    const prisma = getPrisma();
    const existing = await prisma.event.findUnique({ where: { id } });
    if (!existing) throw new Error("Event not found");
    await assertLocation(guard.admin, existing.locationId);
    await prisma.event.delete({ where: { id } });
    void audit({ actorId: guard.admin.id, actorRole: "ADMIN", action: "event.delete", entityType: "Event", entityId: id, metadata: { locationId: existing.locationId }, before: existing });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
