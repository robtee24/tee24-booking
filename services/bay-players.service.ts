/**
 * How many people may play on a bay during a booking, and what happens when
 * GSPro shows more than that.
 *
 * Allowed players = the booking member + the guests they're entitled to on this
 * visit (the larger of their membership's included guests and the guests they
 * declared/paid for when booking), plus one more block of "1 + included
 * guests" for every other member who identifies themselves at the kiosk
 * ("Other players are members" → phone number).
 *
 * Bookings without a member (public web bookings) carry no guest entitlement
 * data, so they are not enforced (allowedPlayers = null).
 */
import { getPrisma } from "@/lib/db";
import { adminNotify } from "@/lib/admin-notify";
import { findMemberByPhone } from "@/services/mobile-auth.service";
import { getBookingAccess, UNAUTHORIZED_GUEST_FEE_CENTS } from "@/services/mobile-booking-access.service";

export class BayPlayersError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type PlayerAllowance = {
  bookingId: string;
  /** null = not enforced for this booking */
  allowedPlayers: number | null;
  booker: { memberId: string | null; firstName: string; lastInitial: string; includedGuests: number; bookedGuests: number };
  companions: { memberId: string; firstName: string; lastInitial: string; includedGuests: number }[];
  unauthorizedGuestFeeCents: number;
};

const initial = (s: string | null | undefined) => (s ?? "").trim().charAt(0).toUpperCase();

export async function getPlayerAllowance(bookingId: string): Promise<PlayerAllowance> {
  const prisma = getPrisma();
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      memberId: true,
      firstName: true,
      lastName: true,
      guestCount: true,
      companions: { select: { memberId: true, includedGuests: true, member: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!booking) throw new BayPlayersError(404, "BOOKING_NOT_FOUND", "Booking not found");

  let includedGuests = 0;
  if (booking.memberId) {
    const access = await getBookingAccess(booking.memberId);
    includedGuests = access.guests.included;
  }
  const companions = booking.companions.map((c) => ({
    memberId: c.memberId,
    firstName: c.member.firstName,
    lastInitial: initial(c.member.lastName),
    includedGuests: c.includedGuests,
  }));

  const allowedPlayers = booking.memberId
    ? 1 + Math.max(includedGuests, booking.guestCount) + companions.reduce((n, c) => n + 1 + c.includedGuests, 0)
    : null;

  return {
    bookingId: booking.id,
    allowedPlayers,
    booker: { memberId: booking.memberId, firstName: booking.firstName, lastInitial: initial(booking.lastName), includedGuests, bookedGuests: booking.guestCount },
    companions,
    unauthorizedGuestFeeCents: UNAUTHORIZED_GUEST_FEE_CENTS,
  };
}

/** "Other players are members": a second member identifies with their phone and lends their allowance to the bay. */
export async function addCompanionByPhone(bookingId: string, phoneDigits: string): Promise<PlayerAllowance & { added: { firstName: string; lastInitial: string; includedGuests: number } }> {
  const prisma = getPrisma();
  const digits = phoneDigits.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) throw new BayPlayersError(400, "PHONE_INVALID", "Enter a 10-digit phone number.");

  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { id: true, memberId: true, phone: true, canceledAt: true } });
  if (!booking) throw new BayPlayersError(404, "BOOKING_NOT_FOUND", "Booking not found");
  if (booking.canceledAt) throw new BayPlayersError(410, "BOOKING_CANCELED", "This reservation was cancelled.");

  const member = await findMemberByPhone(`+1${digits}`);
  if (!member) throw new BayPlayersError(404, "MEMBER_NOT_FOUND", "We couldn't find a Tee24 member with that phone number.");
  if (member.id === booking.memberId || (booking.phone ?? "").replace(/\D/g, "").slice(-10) === digits) {
    throw new BayPlayersError(409, "IS_BOOKER", "That's the number on this reservation. Enter the other member's phone.");
  }

  const access = await getBookingAccess(member.id);
  if (!access.eligible) {
    throw new BayPlayersError(403, "MEMBER_NOT_ACTIVE", `${member.firstName}'s membership isn't active (${access.title.toLowerCase()}), so it can't cover a player here.`);
  }

  await prisma.bookingCompanion.upsert({
    where: { bookingId_memberId: { bookingId, memberId: member.id } },
    create: { bookingId, memberId: member.id, includedGuests: access.guests.included },
    update: { includedGuests: access.guests.included },
  });

  const allowance = await getPlayerAllowance(bookingId);
  return { ...allowance, added: { firstName: member.firstName, lastInitial: initial(member.lastName), includedGuests: access.guests.included } };
}

// ---------- Violations ----------

export type ViolationScreen = "SETUP" | "ROUND";
/** PROCEEDED: accepted the per-guest charge. EXITED: left the game instead (no charge, still reported). */
export type ViolationAction = "PROCEEDED" | "EXITED";

export async function recordGuestViolation(input: {
  deviceId: string;
  bookingId: string | null;
  screen: ViolationScreen;
  action: ViolationAction;
  playerCount: number;
  allowedPlayers: number;
  acknowledgedAt?: Date;
}) {
  const prisma = getPrisma();
  const reg = await prisma.bayAppRegistration.findUnique({
    where: { deviceId: input.deviceId },
    select: { locationId: true, bayNumber: true, location: { select: { slug: true, name: true, organizationId: true, timezone: true, bayAppGuestEnforcement: true } } },
  });
  if (!reg) throw new BayPlayersError(404, "DEVICE_NOT_REGISTERED", "Device not registered");
  // No charges or alerts while the location has enforcement switched off (e.g. a kiosk on an older build).
  if (!reg.location.bayAppGuestEnforcement) throw new BayPlayersError(409, "ENFORCEMENT_OFF", "Guest enforcement is turned off for this location");

  let booking: { id: string; memberId: string | null; firstName: string; lastName: string } | null = null;
  if (input.bookingId) {
    booking = await prisma.booking.findFirst({
      where: { id: input.bookingId, locationId: reg.locationId, bayNumber: reg.bayNumber },
      select: { id: true, memberId: true, firstName: true, lastName: true },
    });
  }

  const playerCount = Math.max(0, Math.min(16, Math.round(input.playerCount)));
  const allowedPlayers = Math.max(0, Math.min(16, Math.round(input.allowedPlayers)));
  const extraGuests = Math.max(1, playerCount - allowedPlayers);
  const exited = input.action === "EXITED";
  const feeCents = exited ? 0 : extraGuests * UNAUTHORIZED_GUEST_FEE_CENTS;
  const acknowledgedAt = input.acknowledgedAt ?? new Date();

  const v = await prisma.guestViolation.create({
    data: {
      locationId: reg.locationId,
      bayNumber: reg.bayNumber,
      bookingId: booking?.id ?? null,
      memberId: booking?.memberId ?? null,
      deviceId: input.deviceId,
      screen: input.screen,
      action: input.action,
      playerCount,
      allowedPlayers,
      extraGuests,
      feeCents,
      acknowledgedAt,
    },
  });

  const who = booking ? `${booking.firstName} ${initial(booking.lastName)}.` : "Unknown player";
  const when = acknowledgedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: reg.location.timezone ?? undefined });
  const where = input.screen === "ROUND" ? "mid-round" : "at round setup";
  void adminNotify({
    organizationId: reg.location.organizationId,
    locationId: reg.locationId,
    kind: "bay.guest-violation",
    severity: exited ? "INFO" : "WARN",
    title: `Bay ${reg.bayNumber}: ${playerCount} players, ${allowedPlayers} allowed`,
    body: exited
      ? `${who} was warned ${where} at ${when} and chose to exit the game (${extraGuests} extra ${extraGuests === 1 ? "player" : "players"}). No charge; the bay relaunched.`
      : `${who} acknowledged the $${(feeCents / 100).toFixed(0)} unauthorized-guest charge (${extraGuests} extra) at ${when} and continued ${where}.`,
    link: `/admin/locations/${reg.location.slug}/bay-alerts?focus=${v.id}`,
    data: { violationId: v.id, bookingId: booking?.id ?? null, memberId: booking?.memberId ?? null, bayNumber: reg.bayNumber, playerCount, allowedPlayers, extraGuests, feeCents, screen: input.screen, action: input.action },
  });

  return { id: v.id, extraGuests, feeCents, acknowledgedAt: acknowledgedAt.toISOString() };
}

// ---------- Admin ----------

export async function listGuestViolations(locationId: string, take = 100) {
  const prisma = getPrisma();
  const rows = await prisma.guestViolation.findMany({
    where: { locationId },
    orderBy: { createdAt: "desc" },
    take,
  });
  const bookingIds = [...new Set(rows.map((r) => r.bookingId).filter((x): x is string => !!x))];
  const memberIds = [...new Set(rows.map((r) => r.memberId).filter((x): x is string => !!x))];
  const [bookings, members] = await Promise.all([
    bookingIds.length ? prisma.booking.findMany({ where: { id: { in: bookingIds } }, select: { id: true, firstName: true, lastName: true, phone: true, email: true, start: true, end: true, guestCount: true } }) : [],
    memberIds.length ? prisma.member.findMany({ where: { id: { in: memberIds } }, select: { id: true, firstName: true, lastName: true } }) : [],
  ]);
  const bMap = new Map(bookings.map((b) => [b.id, b]));
  const mMap = new Map(members.map((m) => [m.id, m]));
  return rows.map((r) => ({
    id: r.id,
    bayNumber: r.bayNumber,
    screen: r.screen,
    action: r.action,
    playerCount: r.playerCount,
    allowedPlayers: r.allowedPlayers,
    extraGuests: r.extraGuests,
    feeCents: r.feeCents,
    acknowledgedAt: r.acknowledgedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    reviewNotes: r.reviewNotes,
    booking: r.bookingId && bMap.get(r.bookingId) ? (() => {
      const b = bMap.get(r.bookingId)!;
      return { id: b.id, name: `${b.firstName} ${b.lastName}`.trim(), phone: b.phone, email: b.email, start: b.start.toISOString(), end: b.end.toISOString(), guestCount: b.guestCount };
    })() : null,
    member: r.memberId && mMap.get(r.memberId) ? { id: r.memberId, name: `${mMap.get(r.memberId)!.firstName} ${mMap.get(r.memberId)!.lastName}`.trim() } : null,
  }));
}

export async function reviewGuestViolation(id: string, adminId: string, notes: string | null) {
  await getPrisma().guestViolation.update({ where: { id }, data: { reviewedById: adminId, reviewedAt: new Date(), reviewNotes: notes } });
  return { ok: true };
}
