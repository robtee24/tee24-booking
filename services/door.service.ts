/**
 * Door access (Kisi) + check-ins.
 *
 *  - syncDoorsFromKisi      : mirror Kisi locks → Door rows (status, place, names)
 *  - unlockDoor             : remote unlock via Kisi, audit-logged
 *  - syncKisiUnlockEvents   : poll Kisi unlock history → Visit rows (check-ins).
 *                             Runs from cron; complements the webhook (which may not be configured).
 *  - check-in read models   : totals, by-location breakdown, per-location feed
 */
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db";
import {
  kisiConfigured,
  kisiListLocks,
  kisiListPlaces,
  kisiListUnlockEvents,
  kisiUnlockLock,
  type KisiLock,
} from "@/lib/kisi";
import { ingestKisiUnlock } from "@/services/attendance.service";

const SYNC_STATE_KEY = "kisi.events.cursor";
type SyncStateValue = { lastEventAt?: string; lastRunAt?: string };

/* ────────────────────────────────────────────────────────────────────────── */
/* Doors                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export type DoorView = {
  id: string;
  kisiLockId: number;
  name: string;
  description: string | null;
  kisiPlaceId: number | null;
  kisiPlaceName: string | null;
  locationId: string | null;
  location: { id: string; name: string; slug: string } | null;
  online: boolean | null;
  configured: boolean | null;
  unlocked: boolean | null;
  open: boolean | null;
  lockedDown: boolean | null;
  lastStatusAt: Date | null;
  lastUnlockAt: Date | null;
  hidden: boolean;
  checkInsToday: number;
};

function statusFromLock(lock: KisiLock) {
  return {
    name: lock.name,
    description: lock.description ?? null,
    kisiPlaceId: lock.place_id ?? lock.place?.id ?? null,
    kisiPlaceName: lock.place?.name ?? null,
    configured: lock.configured ?? null,
    online: lock.online ?? null,
    open: lock.open ?? null,
    unlocked: lock.unlocked ?? null,
    lockedDown: lock.locked_down ?? null,
    lastStatusAt: new Date(),
  };
}

/** Pull every lock from Kisi and upsert into Door. Returns counts. */
export async function syncDoorsFromKisi(): Promise<{ synced: number; created: number; places: number }> {
  if (!kisiConfigured()) throw new Error("Kisi is not configured (KISI_API_KEY missing)");
  const prisma = getPrisma();

  const [locks, places] = await Promise.all([
    kisiListLocks(),
    kisiListPlaces().catch(() => [] as Awaited<ReturnType<typeof kisiListPlaces>>),
  ]);
  const placeName = new Map(places.map((p) => [p.id, p.name]));

  let created = 0;
  for (const lock of locks) {
    const base = statusFromLock(lock);
    if (!base.kisiPlaceName && base.kisiPlaceId != null) {
      base.kisiPlaceName = placeName.get(base.kisiPlaceId) ?? null;
    }
    const existing = await prisma.door.findUnique({ where: { kisiLockId: lock.id }, select: { id: true } });
    if (existing) {
      await prisma.door.update({ where: { id: existing.id }, data: base });
    } else {
      await prisma.door.create({ data: { kisiLockId: lock.id, ...base } });
      created++;
    }
  }
  return { synced: locks.length, created, places: places.length };
}

/** Refresh live status for known doors (cheap: one list call). Silently no-ops without API key. */
export async function refreshDoorStatuses(): Promise<boolean> {
  if (!kisiConfigured()) return false;
  try {
    await syncDoorsFromKisi();
    return true;
  } catch (err) {
    console.error("[doors] status refresh failed", err);
    return false;
  }
}

export async function listDoors(opts: { includeHidden?: boolean; locationId?: string } = {}): Promise<DoorView[]> {
  const prisma = getPrisma();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const doors = await prisma.door.findMany({
    where: {
      ...(opts.includeHidden ? {} : { hidden: false }),
      ...(opts.locationId ? { locationId: opts.locationId } : {}),
    },
    include: {
      location: { select: { id: true, name: true, slug: true } },
      _count: { select: { visits: { where: { enteredAt: { gte: startOfDay } } } } },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return doors.map((d) => ({
    id: d.id,
    kisiLockId: d.kisiLockId,
    name: d.name,
    description: d.description,
    kisiPlaceId: d.kisiPlaceId,
    kisiPlaceName: d.kisiPlaceName,
    locationId: d.locationId,
    location: d.location,
    online: d.online,
    configured: d.configured,
    unlocked: d.unlocked,
    open: d.open,
    lockedDown: d.lockedDown,
    lastStatusAt: d.lastStatusAt,
    lastUnlockAt: d.lastUnlockAt,
    hidden: d.hidden,
    checkInsToday: d._count.visits,
  }));
}

export async function assignDoorToLocation(doorId: string, locationId: string | null) {
  const prisma = getPrisma();
  if (locationId) {
    const loc = await prisma.location.findUnique({ where: { id: locationId }, select: { id: true } });
    if (!loc) throw new Error("Location not found");
  }
  return prisma.door.update({ where: { id: doorId }, data: { locationId } });
}

export async function updateDoor(doorId: string, data: { hidden?: boolean; sortOrder?: number; name?: string }) {
  const prisma = getPrisma();
  return prisma.door.update({ where: { id: doorId }, data });
}

export async function unlockDoor(input: { doorId: string; adminId: string; adminLabel?: string }) {
  const prisma = getPrisma();
  const door = await prisma.door.findUnique({ where: { id: input.doorId } });
  if (!door) throw new Error("Door not found");
  if (!kisiConfigured()) throw new Error("Kisi is not configured (KISI_API_KEY missing)");

  const result = await kisiUnlockLock(door.kisiLockId);
  await prisma.door.update({
    where: { id: door.id },
    data: { lastUnlockAt: new Date(), unlocked: true, lastStatusAt: new Date() },
  });

  await prisma.auditLog
    .create({
      data: {
        actorId: input.adminId,
        action: "door.unlock",
        entityType: "Door",
        entityId: door.id,
        after: { kisiLockId: door.kisiLockId, name: door.name, response: result.message },
        metadata: { locationId: door.locationId, actorLabel: input.adminLabel ?? null },
      },
    })
    .catch(() => {});

  return { message: result.message, door };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Unlock-event polling (check-in ingestion without webhooks)                */
/* ────────────────────────────────────────────────────────────────────────── */

const MAX_WINDOW_MS = 89 * 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const OVERLAP_MS = 5 * 60 * 1000;

export async function syncKisiUnlockEvents(opts: { since?: Date; until?: Date } = {}) {
  if (!kisiConfigured()) return { skipped: true as const, reason: "KISI_API_KEY missing" };
  const prisma = getPrisma();

  const state = await prisma.integrationState.findUnique({ where: { key: SYNC_STATE_KEY } });
  const stateValue = (state?.value ?? {}) as SyncStateValue;
  const lastSyncedAt = stateValue.lastEventAt ? new Date(stateValue.lastEventAt) : null;

  const until = opts.until ?? new Date();
  let from =
    opts.since ??
    (lastSyncedAt ? new Date(lastSyncedAt.getTime() - OVERLAP_MS) : new Date(until.getTime() - DEFAULT_LOOKBACK_MS));
  if (until.getTime() - from.getTime() > MAX_WINDOW_MS) from = new Date(until.getTime() - MAX_WINDOW_MS);

  const events = await kisiListUnlockEvents({ from, to: until });

  let ingested = 0;
  let deduped = 0;
  let newest = lastSyncedAt ?? from;
  // Oldest first so dedupe windows behave deterministically.
  events.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  for (const ev of events) {
    if (!ev.success) continue;
    if (ev.object_type && ev.object_type !== "Lock") continue;
    const at = new Date(ev.created_at);
    const r = await ingestKisiUnlock({
      kisiEventId: ev.uuid,
      kisiUserId: ev.actor_type === "User" && ev.actor_id != null ? String(ev.actor_id) : null,
      kisiDoorId: String(ev.object_id),
      actorEmail: ev.actor_email,
      actorName: ev.actor_name,
      doorName: ev.object_name,
      kisiPlaceId: ev.place_id,
      unlockedAt: at,
      rawEvent: ev,
    });
    if (r.visitId) ingested++;
    if (r.deduped) deduped++;
    if (at > newest) newest = at;
  }

  await prisma.integrationState.upsert({
    where: { key: SYNC_STATE_KEY },
    create: { key: SYNC_STATE_KEY, value: { lastEventAt: newest.toISOString(), lastRunAt: new Date().toISOString() } },
    update: { value: { lastEventAt: newest.toISOString(), lastRunAt: new Date().toISOString() } },
  });

  return { skipped: false as const, fetched: events.length, ingested, deduped, from, until };
}

export async function getKisiSyncState() {
  const prisma = getPrisma();
  const state = await prisma.integrationState.findUnique({ where: { key: SYNC_STATE_KEY } });
  const v = (state?.value ?? {}) as SyncStateValue;
  return {
    lastEventAt: v.lastEventAt ? new Date(v.lastEventAt) : null,
    lastRunAt: v.lastRunAt ? new Date(v.lastRunAt) : null,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Check-in read models                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export type CheckInRange = "today" | "7d" | "30d" | "90d" | "all";

export function rangeStart(range: CheckInRange, now = new Date()): Date | null {
  if (range === "all") return null;
  const d = new Date(now);
  if (range === "today") {
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  d.setDate(d.getDate() - days);
  return d;
}

function visitWhere(range: CheckInRange, locationId?: string) {
  const start = rangeStart(range);
  return {
    source: "KISI",
    ...(start ? { enteredAt: { gte: start } } : {}),
    ...(locationId ? { locationId } : {}),
  };
}

export type CheckInRow = {
  id: string;
  enteredAt: Date;
  lastUnlockAt: Date | null;
  unlockCount: number;
  type: string;
  matchedBy: string | null;
  actorEmail: string | null;
  notes: string | null;
  member: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null } | null;
  door: { id: string; name: string } | null;
  location: { id: string; name: string; slug: string; timezone: string };
  bookingId: string | null;
};

export async function listCheckIns(opts: {
  range: CheckInRange;
  locationId?: string;
  memberId?: string;
  limit?: number;
  offset?: number;
  q?: string;
}): Promise<{ rows: CheckInRow[]; total: number }> {
  const prisma = getPrisma();
  const q = opts.q?.trim();
  const where: Prisma.VisitWhereInput = {
    ...visitWhere(opts.range, opts.locationId),
    ...(opts.memberId ? { memberId: opts.memberId } : {}),
    ...(q
      ? {
          OR: [
            { actorEmail: { contains: q, mode: "insensitive" } },
            { member: { firstName: { contains: q, mode: "insensitive" } } },
            { member: { lastName: { contains: q, mode: "insensitive" } } },
            { member: { email: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [total, visits] = await Promise.all([
    prisma.visit.count({ where }),
    prisma.visit.findMany({
      where,
      include: {
        member: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        door: { select: { id: true, name: true } },
        location: { select: { id: true, name: true, slug: true, timezone: true } },
      },
      orderBy: { enteredAt: "desc" },
      take: opts.limit ?? 100,
      skip: opts.offset ?? 0,
    }),
  ]);
  return {
    total,
    rows: visits.map((v) => ({
      id: v.id,
      enteredAt: v.enteredAt,
      lastUnlockAt: v.dedupedFromAt,
      unlockCount: v.unlockCount,
      type: v.type,
      matchedBy: v.matchedBy,
      actorEmail: v.actorEmail,
      notes: v.notes,
      member: v.member,
      door: v.door,
      location: v.location,
      bookingId: v.bookingId,
    })),
  };
}

export type CheckInOverview = {
  total: number;
  matched: number;
  unmatched: number;
  uniqueMembers: number;
  byLocation: Array<{
    location: { id: string; name: string; slug: string };
    total: number;
    matched: number;
    uniqueMembers: number;
    today: number;
  }>;
};

export async function getCheckInOverview(range: CheckInRange, locationIds?: string[]): Promise<CheckInOverview> {
  const prisma = getPrisma();
  const locations = await prisma.location.findMany({
    where: locationIds ? { id: { in: locationIds } } : {},
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
  });
  const locIds = locations.map((l) => l.id);
  const base = visitWhere(range);
  const todayStart = rangeStart("today")!;

  const [grouped, groupedMatched, groupedToday, distinctMembers] = await Promise.all([
    prisma.visit.groupBy({ by: ["locationId"], where: { ...base, locationId: { in: locIds } }, _count: { _all: true } }),
    prisma.visit.groupBy({
      by: ["locationId"],
      where: { ...base, locationId: { in: locIds }, memberId: { not: null } },
      _count: { _all: true },
    }),
    prisma.visit.groupBy({
      by: ["locationId"],
      where: { source: "KISI", enteredAt: { gte: todayStart }, locationId: { in: locIds } },
      _count: { _all: true },
    }),
    prisma.visit.findMany({
      where: { ...base, locationId: { in: locIds }, memberId: { not: null } },
      select: { locationId: true, memberId: true },
      distinct: ["locationId", "memberId"],
    }),
  ]);

  const count = (rows: Array<{ locationId: string; _count: { _all: number } }>, id: string) =>
    rows.find((r) => r.locationId === id)?._count._all ?? 0;

  const byLocation = locations.map((l) => ({
    location: l,
    total: count(grouped, l.id),
    matched: count(groupedMatched, l.id),
    uniqueMembers: distinctMembers.filter((m) => m.locationId === l.id).length,
    today: count(groupedToday, l.id),
  }));

  const total = byLocation.reduce((s, r) => s + r.total, 0);
  const matched = byLocation.reduce((s, r) => s + r.matched, 0);
  const uniqueMembers = new Set(distinctMembers.map((m) => m.memberId)).size;

  return { total, matched, unmatched: total - matched, uniqueMembers, byLocation };
}

/** Group check-ins by member for the "who checked in" drill-down. */
export async function getCheckInsByMember(opts: { range: CheckInRange; locationId: string; limit?: number }) {
  const prisma = getPrisma();
  const where = { ...visitWhere(opts.range, opts.locationId), memberId: { not: null } };
  const grouped = await prisma.visit.groupBy({
    by: ["memberId"],
    where,
    _count: { _all: true },
    _max: { enteredAt: true },
    orderBy: { _max: { enteredAt: "desc" } },
    take: opts.limit ?? 200,
  });
  const ids = grouped.map((g) => g.memberId!).filter(Boolean);
  const members = await prisma.member.findMany({
    where: { id: { in: ids } },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true },
  });
  const byId = new Map(members.map((m) => [m.id, m]));
  return grouped
    .map((g) => ({
      member: byId.get(g.memberId!) ?? null,
      count: g._count._all,
      lastAt: g._max.enteredAt,
    }))
    .filter((r) => r.member);
}
