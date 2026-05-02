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

export type IngestKisiUnlockInput = {
  kisiEventId: string;
  kisiUserId: string | null;
  kisiDoorId: string | null;
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

  const member = input.kisiUserId
    ? await prisma.member.findFirst({ where: { kisiUserId: input.kisiUserId } })
    : null;

  const locationId = resolveLocationFromDoor(input.kisiDoorId) ?? member?.locationId ?? null;
  if (!locationId) {
    console.warn("[attendance] cannot resolve locationId for kisi event", input.kisiEventId);
    return { visitId: null, deduped: false };
  }

  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: { attendanceDedupeHours: true, reservationMatchBufferMin: true },
  });
  if (!location) return { visitId: null, deduped: false };

  // De-dupe: same member, same location, within window from a previous visit
  const dedupeWindowStart = addHours(input.unlockedAt, -location.attendanceDedupeHours);
  if (member) {
    const recent = await prisma.visit.findFirst({
      where: {
        memberId: member.id,
        locationId,
        enteredAt: { gte: dedupeWindowStart, lte: input.unlockedAt },
      },
      orderBy: { enteredAt: "desc" },
    });
    if (recent) {
      await prisma.visit.update({
        where: { id: recent.id },
        data: {
          unlockCount: { increment: 1 },
          dedupedFromAt: input.unlockedAt,
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
      unlockCount: 1,
    },
  });

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
