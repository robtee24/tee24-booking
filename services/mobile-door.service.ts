/**
 * Member-app door unlock.
 *
 *   1. GPS geofence — the phone must report a fix inside the facility radius.
 *   2. Membership gate — active member, not frozen/cancelled, Kisi access not
 *      disabled by billing/documents (outside the GymDesk migration freeze).
 *   3. Visit allowance — rolling-period plan limits (e.g. Noonan 3/month).
 *   4. Kisi remote unlock of the chosen door.
 *   5. Visit bookkeeping — dedupes into the same-day visit, classifies as a
 *      Reservation when a booking overlaps, fires `visit.checked-in`.
 */
import { addHours, addMinutes, subMinutes } from "date-fns";
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { emitMemberEvent } from "@/lib/events";
import { kisiConfigured, kisiGetLock, kisiUnlockLock } from "@/lib/kisi";
import { isMigrationFrozen } from "@/lib/migration-freeze";
import { MobileError } from "@/services/mobile-auth.service";
import { getVisitAllowance } from "@/services/visit-allowance.service";

export type GeoFix = { lat: number; lng: number; accuracy?: number | null };

/** Great-circle distance in meters. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function parseGeo(raw: Record<string, unknown>): GeoFix | null {
  const lat = Number(raw.lat ?? raw.latitude);
  const lng = Number(raw.lng ?? raw.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const acc = raw.accuracy == null ? null : Number(raw.accuracy);
  return { lat, lng, accuracy: Number.isFinite(acc as number) ? (acc as number) : null };
}

const MAX_ACCURACY_M = 250; // reject very poor fixes outright

export type DoorStatus = {
  location: { id: string; slug: string; name: string; timezone: string; latitude: number | null; longitude: number | null; unlockRadiusMeters: number };
  distanceMeters: number | null;
  inRange: boolean;
  doors: { id: string; name: string; online: boolean | null; unlocked: boolean | null; open: boolean | null; lockedDown: boolean | null; statusAt: string | null }[];
  allowance: Awaited<ReturnType<typeof getVisitAllowance>>;
  canUnlock: boolean;
  blockedCode: string | null;
  blockedReason: string | null;
};

/** Pick the facility: explicit id, else nearest to the fix, else the member's home. */
async function resolveLocation(memberId: string, locationId: string | null, geo: GeoFix | null) {
  const prisma = getPrisma();
  const member = await prisma.member.findUnique({ where: { id: memberId }, select: { locationId: true, homeLocationId: true } });
  const locations = await prisma.location.findMany({
    where: { disabled: false },
    select: { id: true, slug: true, name: true, timezone: true, latitude: true, longitude: true, unlockRadiusMeters: true, attendanceDedupeHours: true, reservationMatchBufferMin: true, doors: { where: { hidden: false }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, online: true, kisiLockId: true } } },
  });
  if (locationId) {
    const l = locations.find((x) => x.id === locationId || x.slug === locationId);
    if (!l) throw new MobileError("Facility not found", 404, "LOCATION_NOT_FOUND");
    return l;
  }
  if (geo) {
    const withGeo = locations.filter((l) => l.latitude != null && l.longitude != null);
    if (withGeo.length) {
      withGeo.sort((a, b) => distanceMeters(geo, { lat: a.latitude!, lng: a.longitude! }) - distanceMeters(geo, { lat: b.latitude!, lng: b.longitude! }));
      return withGeo[0]!;
    }
  }
  const home = locations.find((l) => l.id === (member?.homeLocationId ?? member?.locationId)) ?? locations[0];
  if (!home) throw new MobileError("No facilities configured", 404, "LOCATION_NOT_FOUND");
  return home;
}

function geofence(loc: { latitude: number | null; longitude: number | null; unlockRadiusMeters: number }, geo: GeoFix | null) {
  if (loc.latitude == null || loc.longitude == null) {
    // Facility has no coordinates yet — fail closed: staff must set them in Location Settings.
    return { distance: null, inRange: false, reason: "This facility isn't set up for app unlocks yet. Please use the Kisi app or contact us.", code: "GEOFENCE_UNCONFIGURED" as const };
  }
  if (!geo) return { distance: null, inRange: false, reason: "Turn on Location Services so we can confirm you're at the door.", code: "LOCATION_REQUIRED" as const };
  if (geo.accuracy != null && geo.accuracy > MAX_ACCURACY_M) {
    return { distance: null, inRange: false, reason: "We couldn't get an accurate GPS fix. Step outside or near a window and try again.", code: "LOCATION_INACCURATE" as const };
  }
  const distance = distanceMeters(geo, { lat: loc.latitude, lng: loc.longitude });
  // Give credit for GPS uncertainty, but never more than the radius itself.
  const slack = Math.min(geo.accuracy ?? 0, loc.unlockRadiusMeters);
  const inRange = distance - slack <= loc.unlockRadiusMeters;
  return {
    distance: Math.round(distance),
    inRange,
    reason: inRange ? null : `You're about ${formatDistance(distance)} away. Door unlocks work within ${loc.unlockRadiusMeters} m of the facility.`,
    code: inRange ? null : ("OUT_OF_RANGE" as const),
  };
}

/** Live Kisi lock state. `null` means we could not read it — callers must not invent a locked/unlocked guess. */
async function liveLock(kisiLockId: number): Promise<{ unlocked: boolean; open: boolean | null; lockedDown: boolean; online: boolean | null; statusAt: string } | null> {
  if (!kisiConfigured()) return null;
  try {
    const lock = await Promise.race([
      kisiGetLock(kisiLockId),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("kisi lock timeout")), 4000)),
    ]);
    return {
      unlocked: lock.unlocked === true,
      open: typeof lock.open === "boolean" ? lock.open : null,
      lockedDown: lock.locked_down === true,
      online: lock.online ?? null,
      statusAt: lock.updated_at ?? new Date().toISOString(),
    };
  } catch (err) {
    console.warn("[mobile-door] live lock status failed", err instanceof Error ? err.message : err);
    return null;
  }
}

function formatDistance(m: number) {
  if (m < 1000) return `${Math.round(m)} m`;
  const miles = m / 1609.344;
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

async function membershipGate(memberId: string) {
  const member = await getPrisma().member.findUnique({
    where: { id: memberId },
    select: { status: true, kisiAccessEnabled: true, kisiAccessReason: true },
  });
  if (!member) throw new MobileError("Member not found", 404, "MEMBER_NOT_FOUND");
  if (member.status === "CANCELLED") return { ok: false, code: "MEMBERSHIP_CANCELLED", reason: "Your membership is cancelled. Rejoin at tee24.golf to get back on the sims." };
  if (member.status === "FROZEN") return { ok: false, code: "FROZEN", reason: "Your membership is frozen. Contact us to resume it." };
  if (member.status === "PENDING") return { ok: false, code: "PENDING", reason: "Your membership is still pending activation." };
  if (!isMigrationFrozen() && member.kisiAccessEnabled === false && member.kisiAccessReason) {
    const r = member.kisiAccessReason;
    const reason = /payment|chargeback/i.test(r)
      ? "Door access is paused until your payment is updated. Fix it in Settings → Billing."
      : /doc/i.test(r)
        ? "Please sign your updated waiver to restore door access."
        : "Door access is currently disabled. Contact us for help.";
    return { ok: false, code: "ACCESS_DISABLED", reason };
  }
  return { ok: true as const, code: null, reason: null };
}

export async function getDoorStatus(memberId: string, input: { locationId?: string | null; geo: GeoFix | null }): Promise<DoorStatus> {
  const loc = await resolveLocation(memberId, input.locationId ?? null, input.geo);
  const fence = geofence(loc, input.geo);
  const [gate, allowance, locks] = await Promise.all([
    membershipGate(memberId),
    getVisitAllowance(memberId, { timezone: loc.timezone }),
    Promise.all(loc.doors.map(async (d) => ({ id: d.id, live: d.kisiLockId ? await liveLock(d.kisiLockId) : null }))),
  ]);
  const liveById = new Map(locks.map((l) => [l.id, l.live]));

  let blockedCode: string | null = null;
  let blockedReason: string | null = null;
  if (!gate.ok) {
    blockedCode = gate.code;
    blockedReason = gate.reason;
  } else if (!allowance.canUnlock) {
    blockedCode = allowance.blockedCode;
    blockedReason = allowance.blockedReason;
  } else if (!fence.inRange) {
    blockedCode = fence.code;
    blockedReason = fence.reason;
  } else if (!loc.doors.length) {
    blockedCode = "NO_DOORS";
    blockedReason = "No doors are assigned to this facility yet.";
  }

  return {
    location: { id: loc.id, slug: loc.slug, name: loc.name, timezone: loc.timezone, latitude: loc.latitude, longitude: loc.longitude, unlockRadiusMeters: loc.unlockRadiusMeters },
    distanceMeters: fence.distance,
    inRange: fence.inRange,
    doors: loc.doors.map((d) => {
      const live = liveById.get(d.id);
      return {
        id: d.id,
        name: d.name,
        online: live ? live.online : d.online,
        unlocked: live ? live.unlocked : null,
        open: live ? live.open : null,
        lockedDown: live ? live.lockedDown : null,
        statusAt: live ? live.statusAt : null,
      };
    }),
    allowance,
    canUnlock: blockedCode == null,
    blockedCode,
    blockedReason,
  };
}

export async function unlockDoorForMember(memberId: string, input: { locationId?: string | null; doorId?: string | null; geo: GeoFix | null }) {
  const prisma = getPrisma();
  const status = await getDoorStatus(memberId, input);
  if (!status.canUnlock) {
    void audit({ actorId: memberId, actorRole: "MEMBER", action: "door.mobile-unlock-denied", entityType: "Location", entityId: status.location.id, metadata: { code: status.blockedCode, distanceMeters: status.distanceMeters } });
    throw new MobileError(status.blockedReason ?? "Unlock not allowed right now", 403, status.blockedCode ?? "FORBIDDEN", { status });
  }
  if (!kisiConfigured()) throw new MobileError("Door system is offline. Please use the Kisi app or contact us.", 503, "KISI_UNAVAILABLE");

  const door = await prisma.door.findFirst({
    where: { locationId: status.location.id, hidden: false, ...(input.doorId ? { id: input.doorId } : {}) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  if (!door) throw new MobileError("Door not found", 404, "NO_DOORS");

  const before = await liveLock(door.kisiLockId);
  if (before?.lockedDown) throw new MobileError("This door is locked down. Contact the club and we'll open it from here.", 403, "LOCKED_DOWN");

  const now = new Date();
  let kisiMessage = "";
  try {
    const res = await kisiUnlockLock(door.kisiLockId);
    kisiMessage = res?.message ?? "Unlocked";
  } catch (err) {
    console.error("[mobile-door] kisi unlock failed", err);
    throw new MobileError("The door didn't respond. Try again in a moment, or use the Kisi app.", 502, "KISI_UNLOCK_FAILED");
  }
  const live = (await liveLock(door.kisiLockId)) ?? before;
  await prisma.door.update({ where: { id: door.id }, data: { lastUnlockAt: now, unlocked: live ? live.unlocked : true, lastStatusAt: now, online: live?.online ?? undefined } }).catch(() => {});

  // ── Visit bookkeeping (same dedupe rules as Kisi ingestion) ──
  const loc = await prisma.location.findUnique({ where: { id: status.location.id }, select: { attendanceDedupeHours: true, reservationMatchBufferMin: true } });
  const dedupeHours = loc?.attendanceDedupeHours ?? 2;
  const recent = await prisma.visit.findFirst({
    where: { memberId, locationId: status.location.id, enteredAt: { gte: addHours(now, -dedupeHours), lte: addHours(now, dedupeHours) } },
    orderBy: { enteredAt: "desc" },
  });
  let visitId: string;
  let newVisit = false;
  if (recent) {
    await prisma.visit.update({ where: { id: recent.id }, data: { unlockCount: { increment: 1 }, dedupedFromAt: now, ...(recent.doorId ? {} : { doorId: door.id }) } });
    visitId = recent.id;
  } else {
    const member = await prisma.member.findUnique({ where: { id: memberId }, select: { email: true, phone: true, firstName: true, lastName: true, organizationId: true } });
    const buffer = loc?.reservationMatchBufferMin ?? 15;
    const booking = await prisma.booking.findFirst({
      where: {
        OR: [{ memberId }, ...(member ? [{ email: member.email }, { phone: member.phone }] : [])],
        locationId: status.location.id,
        canceledAt: null,
        start: { lte: addMinutes(now, buffer) },
        end: { gte: subMinutes(now, buffer) },
      },
      orderBy: { start: "asc" },
    });
    let bayId: string | null = null;
    if (booking) {
      const bay = await prisma.bay.findFirst({ where: { locationId: status.location.id, number: booking.bayNumber }, select: { id: true } });
      bayId = bay?.id ?? null;
      if (!booking.checkedInAt) await prisma.booking.update({ where: { id: booking.id }, data: { checkedInAt: now } }).catch(() => {});
    }
    const visit = await prisma.visit.create({
      data: {
        memberId,
        locationId: status.location.id,
        bayId,
        type: booking ? "RESERVATION" : "WALK_IN",
        source: "MOBILE_APP",
        enteredAt: now,
        bookingId: booking?.id ?? null,
        doorId: door.id,
        actorEmail: member?.email ?? null,
        matchedBy: "MOBILE_SESSION",
        unlockCount: 1,
      },
    });
    visitId = visit.id;
    newVisit = true;
    if (member) {
      void emitMemberEvent("visit.checked-in", {
        memberId,
        locationId: status.location.id,
        organizationId: member.organizationId,
        refs: { visitId: visit.id },
        vars: { visitType: booking ? "RESERVATION" : "WALK_IN", firstName: member.firstName, lastName: member.lastName, source: "MOBILE_APP" },
      });
    }
  }

  void audit({ actorId: memberId, actorRole: "MEMBER", action: "door.mobile-unlock", entityType: "Door", entityId: door.id, after: { kisi: kisiMessage, visitId }, metadata: { locationId: status.location.id, distanceMeters: status.distanceMeters, newVisit } });

  const allowance = await getVisitAllowance(memberId, { timezone: status.location.timezone });
  return {
    door: { id: door.id, name: door.name },
    location: status.location,
    visitId,
    newVisit,
    allowance,
    message: kisiMessage,
    lock: live,
  };
}
