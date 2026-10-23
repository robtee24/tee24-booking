/**
 * Member-app read models: the "home" payload (member + membership + visit
 * allowance + locations + device), facility list, and small self-service
 * writes (home facility, profile, cancellation request).
 */
import { getPrisma } from "@/lib/db";
import { membershipDisplayName } from "@/lib/membership-pricing";
import { getVisitAllowance } from "@/services/visit-allowance.service";
import { getActiveDevice, MobileError } from "@/services/mobile-auth.service";
import { getBookingAccess } from "@/services/mobile-booking-access.service";
import { submitMembershipRequest, updateOwnProfile } from "@/services/portal.service";

export type MobileLocation = {
  id: string;
  slug: string;
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  timezone: string;
  open24Hours: boolean;
  hours: unknown;
  latitude: number | null;
  longitude: number | null;
  unlockRadiusMeters: number;
  minBookingMinutes: number;
  maxBookingMinutes: number;
  bookingNote: string | null;
  bays: { total: number; single: number; group: number };
  doors: { id: string; name: string; online: boolean | null }[];
};

export async function listMobileLocations(): Promise<MobileLocation[]> {
  const rows = await getPrisma().location.findMany({
    where: { disabled: false },
    orderBy: { name: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      zip: true,
      phone: true,
      timezone: true,
      open24Hours: true,
      hours: true,
      latitude: true,
      longitude: true,
      unlockRadiusMeters: true,
      minBookingMinutes: true,
      maxBookingMinutes: true,
      bookingNote: true,
      bays: { where: { disabled: false }, select: { kind: true } },
      doors: { where: { hidden: false }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, online: true } },
    },
  });
  return rows.map((l) => ({
    ...l,
    bays: {
      total: l.bays.length,
      single: l.bays.filter((b) => b.kind === "SINGLE").length,
      group: l.bays.filter((b) => b.kind === "GROUP").length,
    },
  }));
}

export async function getMemberHome(memberId: string) {
  const prisma = getPrisma();
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      status: true,
      photoUrl: true,
      dob: true,
      locationId: true,
      homeLocationId: true,
      joinDate: true,
      membershipStartDate: true,
      kisiAccessEnabled: true,
      kisiAccessReason: true,
      referralCode: true,
      optInSmsMarketing: true,
      optInEmailMarketing: true,
      createdAt: true,
    },
  });
  if (!member) throw new MobileError("Member not found", 404, "MEMBER_NOT_FOUND");

  const [locations, sub, allowance, device, openInvoice, paymentMethod, nextBooking, bookingAccess] = await Promise.all([
    listMobileLocations(),
    prisma.membershipSubscription.findFirst({
      where: { memberId, status: { in: ["ACTIVE", "CANCEL_SCHEDULED", "FROZEN", "COMP", "PENDING"] } },
      include: { plan: { select: { id: true, name: true, description: true, visitsPerPeriod: true, visitPeriod: true, billingCadence: true } } },
      orderBy: [{ status: "asc" }, { startDate: "desc" }],
    }),
    getVisitAllowance(memberId),
    getActiveDevice(memberId),
    prisma.invoice.findFirst({
      where: { memberId, status: { in: ["SCHEDULED", "PAST_DUE", "FAILED"] } },
      orderBy: { dueDate: "asc" },
      select: { id: true, status: true, dueDate: true, totalCents: true, payToken: true },
    }),
    prisma.paymentMethod.findFirst({ where: { memberId, isDefault: true, status: "ACTIVE" }, select: { brand: true, last4: true, expMonth: true, expYear: true } }),
    prisma.booking.findFirst({
      where: { memberId, canceledAt: null, end: { gte: new Date() } },
      orderBy: { start: "asc" },
      select: { id: true, start: true, end: true, bayNumber: true, Location: { select: { id: true, slug: true, name: true, timezone: true } } },
    }),
    getBookingAccess(memberId),
  ]);

  const homeLocation = locations.find((l) => l.id === (member.homeLocationId ?? member.locationId)) ?? locations.find((l) => l.id === member.locationId) ?? locations[0] ?? null;

  return {
    member: {
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      email: member.email,
      phone: member.phone,
      status: member.status,
      photoUrl: member.photoUrl,
      dob: member.dob?.toISOString() ?? null,
      memberSince: (member.joinDate ?? member.membershipStartDate ?? member.createdAt).toISOString(),
      referralCode: member.referralCode,
      doorAccessEnabled: member.kisiAccessEnabled,
      doorAccessReason: member.kisiAccessReason,
      optInSmsMarketing: member.optInSmsMarketing,
      optInEmailMarketing: member.optInEmailMarketing,
    },
    membership: sub
      ? {
          id: sub.id,
          status: sub.status,
          planId: sub.plan.id,
          planName: membershipDisplayName(sub.plan.name, sub.guestCount),
          planDescription: sub.plan.description,
          priceCents: sub.priceCents,
          billingCadence: sub.billingCadence,
          startDate: sub.startDate.toISOString(),
          paidThroughDate: sub.paidThroughDate?.toISOString() ?? null,
          nextInvoiceDate: sub.nextInvoiceDate?.toISOString() ?? null,
          cancelScheduledFor: sub.cancelScheduledFor?.toISOString() ?? null,
          cancelRequestedAt: sub.cancelRequestedAt?.toISOString() ?? null,
          visitsPerPeriod: sub.plan.visitsPerPeriod,
          visitPeriod: sub.plan.visitPeriod,
        }
      : null,
    allowance,
    billing: {
      openInvoice: openInvoice
        ? { id: openInvoice.id, status: openInvoice.status, dueDate: openInvoice.dueDate.toISOString(), totalCents: openInvoice.totalCents, payToken: openInvoice.payToken }
        : null,
      paymentMethod,
    },
    homeLocationId: homeLocation?.id ?? null,
    bookingAccess,
    locations,
    device: device
      ? { id: device.id, name: device.name, model: device.model, platform: device.platform, boundAt: device.boundAt.toISOString(), lastSeenAt: device.lastSeenAt?.toISOString() ?? null }
      : null,
    nextBooking: nextBooking
      ? { id: nextBooking.id, start: nextBooking.start.toISOString(), end: nextBooking.end.toISOString(), bayNumber: nextBooking.bayNumber, location: nextBooking.Location }
      : null,
  };
}

export async function setHomeLocation(memberId: string, locationId: string) {
  const prisma = getPrisma();
  const loc = await prisma.location.findUnique({ where: { id: locationId, disabled: false }, select: { id: true } });
  if (!loc) throw new MobileError("Facility not found", 404, "LOCATION_NOT_FOUND");
  await prisma.member.update({ where: { id: memberId }, data: { homeLocationId: locationId } });
  return { homeLocationId: locationId };
}

export async function updateMobileProfile(memberId: string, raw: Record<string, unknown>) {
  // Phone changes would break OTP login + device binding; keep them staff-only from the app.
  const { phone: _phone, ...rest } = raw;
  return updateOwnProfile(memberId, rest);
}

export async function requestCancellation(memberId: string, reason?: string) {
  return submitMembershipRequest(memberId, "cancel", { reason });
}

export async function updatePreferences(memberId: string, prefs: { optInSmsMarketing?: boolean; optInEmailMarketing?: boolean }) {
  const data: Record<string, unknown> = {};
  if (typeof prefs.optInSmsMarketing === "boolean") {
    data.optInSmsMarketing = prefs.optInSmsMarketing;
    if (prefs.optInSmsMarketing) {
      data.smsConsentAt = new Date();
      data.smsConsentSource = "mobile_app";
    }
  }
  if (typeof prefs.optInEmailMarketing === "boolean") data.optInEmailMarketing = prefs.optInEmailMarketing;
  await getPrisma().member.update({ where: { id: memberId }, data });
  return data;
}

export async function listRecentVisits(memberId: string, limit = 20) {
  const visits = await getPrisma().visit.findMany({
    where: { memberId },
    orderBy: { enteredAt: "desc" },
    take: limit,
    select: { id: true, enteredAt: true, type: true, source: true, unlockCount: true, location: { select: { id: true, name: true, slug: true, timezone: true } } },
  });
  return visits.map((v) => ({ ...v, enteredAt: v.enteredAt.toISOString() }));
}
