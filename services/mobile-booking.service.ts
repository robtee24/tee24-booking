/**
 * Member-app bay reservations — thin wrapper over the public booking flow that
 * fills the guest fields from the member record and links `memberId`.
 */
import { getPrisma } from "@/lib/db";
import { getAvailability } from "@/services/availability.service";
import { cancelBooking, createBooking } from "@/services/booking.service";
import { MobileError } from "@/services/mobile-auth.service";

export type MobileBookingView = {
  id: string;
  start: string;
  end: string;
  bayNumber: number;
  status: "UPCOMING" | "IN_PROGRESS" | "PAST" | "CANCELLED";
  checkedInAt: string | null;
  location: { id: string; slug: string; name: string; timezone: string };
};

function viewOf(b: { id: string; start: Date; end: Date; bayNumber: number; canceledAt: Date | null; checkedInAt: Date | null; Location: { id: string; slug: string; name: string; timezone: string } }, now = new Date()): MobileBookingView {
  const status = b.canceledAt ? "CANCELLED" : b.end < now ? "PAST" : b.start <= now ? "IN_PROGRESS" : "UPCOMING";
  return {
    id: b.id,
    start: b.start.toISOString(),
    end: b.end.toISOString(),
    bayNumber: b.bayNumber,
    status,
    checkedInAt: b.checkedInAt?.toISOString() ?? null,
    location: b.Location,
  };
}

export async function listMemberBookings(memberId: string) {
  const prisma = getPrisma();
  const member = await prisma.member.findUnique({ where: { id: memberId }, select: { email: true, phone: true } });
  const digits = (member?.phone ?? "").replace(/\D/g, "").slice(-10);
  const since = new Date(Date.now() - 90 * 86_400_000);
  const rows = await prisma.booking.findMany({
    where: {
      OR: [
        { memberId },
        ...(member?.email ? [{ email: { equals: member.email, mode: "insensitive" as const } }] : []),
        ...(digits.length === 10 ? [{ phone: { contains: digits } }] : []),
      ],
      end: { gte: since },
    },
    orderBy: { start: "asc" },
    select: { id: true, start: true, end: true, bayNumber: true, canceledAt: true, checkedInAt: true, Location: { select: { id: true, slug: true, name: true, timezone: true } } },
  });
  const now = new Date();
  const views = rows.map((r) => viewOf(r, now));
  return {
    upcoming: views.filter((v) => v.status === "UPCOMING" || v.status === "IN_PROGRESS"),
    past: views.filter((v) => v.status === "PAST" || v.status === "CANCELLED").reverse().slice(0, 30),
  };
}

export async function getMobileAvailability(input: { locationSlug: string; date: string; kind: "SINGLE" | "GROUP"; hand?: "RH" | "LH" }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new MobileError("Invalid date", 400, "BAD_REQUEST");
  const result = await getAvailability({ ...input, includeSlots: true });
  const location = await getPrisma().location.findUnique({ where: { slug: input.locationSlug }, select: { timezone: true, minBookingMinutes: true, maxBookingMinutes: true } });
  return { ...result, timezone: location?.timezone ?? "America/New_York", minBookingMinutes: location?.minBookingMinutes ?? 60, maxBookingMinutes: location?.maxBookingMinutes ?? 120 };
}

export async function createMemberBooking(memberId: string, input: { locationSlug: string; startLocal: string; endLocal: string; partyKind: "SINGLE" | "GROUP"; handedness?: "RH" | "LH" }) {
  const member = await getPrisma().member.findUnique({ where: { id: memberId }, select: { firstName: true, lastName: true, email: true, phone: true } });
  if (!member) throw new MobileError("Member not found", 404, "MEMBER_NOT_FOUND");
  try {
    const booking = await createBooking({
      startLocal: input.startLocal,
      endLocal: input.endLocal,
      locationSlug: input.locationSlug,
      firstName: member.firstName,
      lastName: member.lastName,
      email: member.email,
      phone: member.phone,
      partyKind: input.partyKind,
      handedness: input.handedness ?? "RH",
      source: "PUBLIC",
      memberId,
    });
    return booking;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Couldn't create the reservation";
    const code = /No bay available|not available/i.test(msg) ? "NO_BAY_AVAILABLE" : /limit|maximum|consecutive|active booking/i.test(msg) ? "BOOKING_LIMIT" : "BOOKING_FAILED";
    throw new MobileError(msg, 400, code);
  }
}

export async function cancelMemberBooking(memberId: string, bookingId: string) {
  const prisma = getPrisma();
  const [booking, member] = await Promise.all([
    prisma.booking.findUnique({ where: { id: bookingId }, select: { id: true, memberId: true, email: true, phone: true, canceledAt: true, start: true } }),
    prisma.member.findUnique({ where: { id: memberId }, select: { email: true, phone: true } }),
  ]);
  if (!booking) throw new MobileError("Reservation not found", 404, "NOT_FOUND");
  const digits = (member?.phone ?? "").replace(/\D/g, "").slice(-10);
  const owns = booking.memberId === memberId || (member?.email && booking.email.toLowerCase() === member.email.toLowerCase()) || (digits && booking.phone.replace(/\D/g, "").endsWith(digits));
  if (!owns) throw new MobileError("That reservation isn't yours", 403, "FORBIDDEN");
  if (booking.canceledAt) throw new MobileError("Already cancelled", 410, "ALREADY_CANCELLED");
  if (booking.start < new Date()) throw new MobileError("This reservation has already started", 400, "ALREADY_STARTED");
  await cancelBooking(bookingId);
  return { id: bookingId };
}
