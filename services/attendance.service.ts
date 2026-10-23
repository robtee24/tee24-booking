/**
 * Attendance ingestion + visit classification.
 *
 * Pipeline:
 *   Kisi unlock event
 *     -> resolve memberId via kisiUserId mirror
 *     -> resolve locationId via door->location map (TODO: env-driven for v1)
 *     -> de-dupe within Location.attendanceDedupeHours window
 *     -> classify visit type (Reservation if booking exists within ±buffer min,
 *        else Walk-in / Day Pass / Class / Manual)
 *     -> create or update Visit row
 */
import { addHours, addMinutes, subMinutes } from "date-fns";
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { emitMemberEvent } from "@/lib/events";

export type IngestKisiUnlockInput = {
  kisiEventId: string;
  kisiUserId: string | null;
  kisiDoorId: string | null;
  /** Email of the Kisi actor (preferred match key: Kisi email ↔ Member.email). */
  actorEmail?: string | null;
  actorName?: string | null;
  /** Door name as reported by Kisi (used to auto-register unknown doors). */
  doorName?: string | null;
  kisiPlaceId?: number | null;
  unlockedAt: Date;
  rawEvent: any;
};

/**
 * Map a Kisi door id to one of our locations.
 * v1: env var KISI_DOOR_TO_LOCATION_MAP = JSON map of {doorId: locationId}.
 * v2: DB-backed Location.kisiDoorIds field with admin UI.
 */
function resolveLocationFromDoor(kisiDoorId: string | null): string | null {
  if (!kisiDoorId) return null;
  const raw = process.env.KISI_DOOR_TO_LOCATION_MAP;
  if (!raw) return null;
  try {
    const map = JSON.parse(raw) as Record<string, string>;
    return map[kisiDoorId] ?? null;
  } catch {
    return null;
  }
}

export async function ingestKisiUnlock(input: IngestKisiUnlockInput): Promise<{ visitId: string | null; deduped: boolean }> {
  const prisma = getPrisma();

  // Idempotency: if we already processed this kisiEventId, no-op
  const existing = await prisma.visit.findUnique({ where: { kisiEventId: input.kisiEventId } });
  if (existing) return { visitId: existing.id, deduped: false };

  // Door: look up (or auto-register) the Kisi lock so admins can assign it to a location.
  const lockId = input.kisiDoorId && /^\d+$/.test(input.kisiDoorId) ? Number(input.kisiDoorId) : null;
  let door =
    lockId != null
      ? await prisma.door.findUnique({ where: { kisiLockId: lockId } })
      : null;
  if (!door && lockId != null) {
    door = await prisma.door.create({
      data: {
        kisiLockId: lockId,
        name: input.doorName?.trim() || `Door ${lockId}`,
        kisiPlaceId: input.kisiPlaceId ?? null,
      },
    });
  }

  // Member: Kisi user id mirror first, then email (the primary key the business uses).
  const email = input.actorEmail?.trim().toLowerCase() || null;
  let member = input.kisiUserId
    ? await prisma.member.findFirst({ where: { kisiUserId: input.kisiUserId } })
    : null;
  let matchedBy: "KISI_USER_ID" | "EMAIL" | "NONE" = member ? "KISI_USER_ID" : "NONE";
  if (!member && email) {
    const candidates = await prisma.member.findMany({
      where: { email: { equals: email, mode: "insensitive" } },
      orderBy: { createdAt: "asc" },
    });
    if (candidates.length) {
      const preferred = door?.locationId ? candidates.find((m) => m.locationId === door!.locationId) : null;
      member = preferred ?? candidates[0];
      matchedBy = "EMAIL";
    }
  }

  const locationId =
    door?.locationId ?? resolveLocationFromDoor(input.kisiDoorId) ?? member?.locationId ?? null;
  if (!locationId) {
    console.warn("[attendance] cannot resolve locationId for kisi event", input.kisiEventId);
    return { visitId: null, deduped: false };
  }

  // Member-app unlocks go through our API key, so Kisi reports *our* integration
  // user as the actor. The app already wrote a MOBILE_APP visit for the member a
  // moment earlier — attach this event to it instead of creating an unmatched row.
  if (!member) {
    const appVisit = await prisma.visit.findFirst({
      where: {
        locationId,
        source: "MOBILE_APP",
        kisiEventId: null,
        AND: [
          {
            OR: [
              { enteredAt: { gte: addMinutes(input.unlockedAt, -3), lte: addMinutes(input.unlockedAt, 3) } },
              { dedupedFromAt: { gte: addMinutes(input.unlockedAt, -3), lte: addMinutes(input.unlockedAt, 3) } },
            ],
          },
          ...(door ? [{ OR: [{ doorId: door.id }, { doorId: null }] }] : []),
        ],
      },
      orderBy: { enteredAt: "desc" },
    });
    if (appVisit) {
      await prisma.visit.update({ where: { id: appVisit.id }, data: { kisiEventId: input.kisiEventId, ...(door && !appVisit.doorId ? { doorId: door.id } : {}) } }).catch(() => {});
      if (door) await prisma.door.update({ where: { id: door.id }, data: { lastUnlockAt: input.unlockedAt } }).catch(() => {});
      return { visitId: appVisit.id, deduped: true };
    }
  }

  if (door) {
    await prisma.door.update({ where: { id: door.id }, data: { lastUnlockAt: input.unlockedAt } }).catch(() => {});
  }

  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: { attendanceDedupeHours: true, reservationMatchBufferMin: true },
  });
  if (!location) return { visitId: null, deduped: false };

  // De-dupe: same member, same location, within window from a previous visit
  // Window is symmetric so out-of-order deliveries (webhook retry, backfill) still collapse.
  const dedupeWindowStart = addHours(input.unlockedAt, -location.attendanceDedupeHours);
  const dedupeWindowEnd = addHours(input.unlockedAt, location.attendanceDedupeHours);
  if (member) {
    const recent = await prisma.visit.findFirst({
      where: {
        memberId: member.id,
        locationId,
        enteredAt: { gte: dedupeWindowStart, lte: dedupeWindowEnd },
      },
      orderBy: { enteredAt: "desc" },
    });
    if (recent) {
      const earlier = input.unlockedAt < recent.enteredAt;
      await prisma.visit.update({
        where: { id: recent.id },
        data: {
          unlockCount: { increment: 1 },
          // Keep enteredAt = first unlock, dedupedFromAt = most recent unlock.
          ...(earlier
            ? { enteredAt: input.unlockedAt, dedupedFromAt: recent.dedupedFromAt ?? recent.enteredAt }
            : { dedupedFromAt: input.unlockedAt }),
          ...(door && !recent.doorId ? { doorId: door.id } : {}),
        },
      });
      return { visitId: recent.id, deduped: true };
    }
  }

  // Classify visit type by booking match within ±buffer minutes
  let type: string = "WALK_IN";
  let bookingId: string | null = null;
  let bayId: string | null = null;

  if (member) {
    const buffer = location.reservationMatchBufferMin;
    const matchStart = subMinutes(input.unlockedAt, buffer);
    const matchEnd = addMinutes(input.unlockedAt, buffer);
    const booking = await prisma.booking.findFirst({
      where: {
        OR: [{ memberId: member.id }, { email: member.email }, { phone: member.phone }],
        locationId,
        canceledAt: null,
        start: { lte: matchEnd },
        end: { gte: matchStart },
      },
      orderBy: { start: "asc" },
    });
    if (booking) {
      type = "RESERVATION";
      bookingId = booking.id;

      const bay = await prisma.bay.findFirst({
        where: { locationId, number: booking.bayNumber },
        select: { id: true },
      });
      bayId = bay?.id ?? null;

      // Mark booking as checked-in if not already
      if (!booking.checkedInAt) {
        await prisma.booking.update({
          where: { id: booking.id },
          data: { checkedInAt: input.unlockedAt },
        });
      }
    }
  }

  const visit = await prisma.visit.create({
    data: {
      memberId: member?.id ?? null,
      locationId,
      bayId,
      type,
      source: "KISI",
      enteredAt: input.unlockedAt,
      bookingId,
      kisiEventId: input.kisiEventId,
      doorId: door?.id ?? null,
      actorEmail: email,
      matchedBy,
      unlockCount: 1,
      notes: !member && input.actorName ? `Kisi user: ${input.actorName}` : undefined,
    },
  });

  // Door unlocks are how nearly every visit is recorded at a 24/7 facility, so they must
  // drive the same "visit.checked-in" automations as a front-desk check-in. Only the first
  // unlock of a visit gets here (later unlocks are deduped above), so this fires once per visit.
  if (member) {
    void emitMemberEvent("visit.checked-in", {
      memberId: member.id,
      locationId,
      organizationId: member.organizationId,
      refs: { visitId: visit.id },
      vars: { visitType: type, firstName: member.firstName, lastName: member.lastName, source: "KISI" },
    });
  }

  return { visitId: visit.id, deduped: false };
}

/**
 * Manually add a visit (admin tool).
 */
export async function addManualVisit(input: {
  memberId: string | null;
  visitorId: string | null;
  locationId: string;
  type: string;
  enteredAt: Date;
  notes?: string;
  createdById?: string;
}) {
  const prisma = getPrisma();
  return prisma.visit.create({
    data: {
      memberId: input.memberId,
      visitorId: input.visitorId,
      locationId: input.locationId,
      type: input.type,
      source: "MANUAL",
      enteredAt: input.enteredAt,
      notes: input.notes,
      unlockCount: 1,
    },
  });
}

/** Update the free-text notes (and optionally type / time) on a visit. */
export async function updateVisit(
  visitId: string,
  patch: { notes?: string | null; type?: string; enteredAt?: Date },
  actorId?: string
) {
  const prisma = getPrisma();
  const before = await prisma.visit.findUnique({ where: { id: visitId } });
  if (!before) throw new Error("Visit not found");
  const updated = await prisma.visit.update({
    where: { id: visitId },
    data: {
      notes: patch.notes === undefined ? undefined : patch.notes,
      type: patch.type ?? undefined,
      enteredAt: patch.enteredAt ?? undefined,
    },
  });
  void audit({
    actorId,
    action: "member.update",
    entityType: "Visit",
    entityId: visitId,
    before: { notes: before.notes, type: before.type, enteredAt: before.enteredAt },
    after: { notes: updated.notes, type: updated.type, enteredAt: updated.enteredAt },
    metadata: { event: "visit.updated", memberId: before.memberId },
  });
  return updated;
}

export async function deleteVisit(visitId: string, actorId?: string) {
  const prisma = getPrisma();
  const before = await prisma.visit.findUnique({ where: { id: visitId } });
  if (!before) throw new Error("Visit not found");
  await prisma.visit.delete({ where: { id: visitId } });
  void audit({
    actorId,
    action: "member.update",
    entityType: "Visit",
    entityId: visitId,
    before,
    metadata: { event: "visit.deleted", memberId: before.memberId },
  });
}

/** Paginated visit history + totals for a member profile. */
export async function listMemberVisits(memberId: string, opts: { page?: number; pageSize?: number } = {}) {
  const prisma = getPrisma();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const ninetyAgo = new Date(now.getTime() - 90 * 86_400_000);

  const [items, total, thisMonth, last90, allTime] = await Promise.all([
    prisma.visit.findMany({
      where: { memberId },
      orderBy: { enteredAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { bay: { select: { number: true, name: true } } },
    }),
    prisma.visit.count({ where: { memberId } }),
    prisma.visit.count({ where: { memberId, enteredAt: { gte: monthStart } } }),
    prisma.visit.count({ where: { memberId, enteredAt: { gte: ninetyAgo } } }),
    prisma.visit.count({ where: { memberId } }),
  ]);
  return { items, total, page, pageSize, totals: { thisMonth, last90, allTime } };
}

/**
 * Compute a member's usage tier given their visit history (last 90d).
 * Tiers: ABOVE_AVG (>cohort 70th pctile), AVERAGE, LIGHT (<cohort 30th pctile),
 *        AT_RISK (<2 visits in last 30d AND was previously active),
 *        INACTIVE (<1 visit in last 60d).
 */
export type UsageTier = "ABOVE_AVG" | "AVERAGE" | "LIGHT" | "AT_RISK" | "INACTIVE";

export function classifyUsageTier(input: {
  visits30d: number;
  visits90d: number;
  cohortP30Visits90d: number;
  cohortP70Visits90d: number;
  prevTier?: UsageTier;
}): UsageTier {
  if (input.visits30d === 0 && input.visits90d <= 1) return "INACTIVE";
  if (input.visits30d <= 1 && (input.prevTier === "AVERAGE" || input.prevTier === "ABOVE_AVG")) return "AT_RISK";
  if (input.visits90d >= input.cohortP70Visits90d) return "ABOVE_AVG";
  if (input.visits90d <= input.cohortP30Visits90d) return "LIGHT";
  return "AVERAGE";
}
