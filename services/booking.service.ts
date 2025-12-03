// src/services/booking.service.ts
import { getPrisma } from "@/lib/db";
import crypto from "crypto";
import { fromZonedTime } from "date-fns-tz";
import { sendEmail } from "@/lib/sendEmail";
import { sendSms } from "@/lib/sendSms";
import { renderTemplate, formatDate, formatTime } from "@/lib/template";

type IdentifyBy = "EMAIL" | "PHONE" | "EMAIL_OR_PHONE";

// ─────────────────────────────────────────────────────────────────────────────
// CREATE BOOKING
// ─────────────────────────────────────────────────────────────────────────────
export type CreateBookingInput = {
  startLocal: string;
  endLocal: string;
  locationId?: string;
  locationSlug?: string;
  bayId?: string | null;
  bayNumber?: number | null;
  firstName: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  partyKind?: "SINGLE" | "GROUP";
  handedness?: "RH" | "LH";
  source: "PUBLIC" | "ADMIN";
};

export async function createBooking(input: CreateBookingInput) {
  const {
    startLocal,
    endLocal,
    locationId: locationIdInput,
    locationSlug,
    bayId,
    bayNumber: bayNumberInput,
    firstName,
    lastName,
    email,
    phone,
    partyKind = "GROUP",
    handedness,
    source,
  } = input;

  // 1. Parse local time
  const cleanStart = startLocal.replace(/Z$/i, "").replace(/\.\d+$/, "");
  const cleanEnd = endLocal.replace(/Z$/i, "").replace(/\.\d+$/, "");
  const localStart = new Date(cleanStart);
  const localEnd = new Date(cleanEnd);
  if (isNaN(localStart.getTime()) || isNaN(localEnd.getTime()))
    throw new Error("Invalid date format");
  if (localEnd <= localStart)
    throw new Error("End must be after start");

  // 2. Resolve location + timezone
  let locationId = locationIdInput;
  if (!locationId && locationSlug) {
    const loc = await getPrisma().location.findUnique({
      where: { slug: locationSlug },
      select: { id: true },
    });
    if (!loc) throw new Error("Location not found");
    locationId = loc.id;
  }
  if (!locationId) throw new Error("Location required");

  const location = await getPrisma().location.findUnique({
    where: { id: locationId },
    select: {
      id: true,
      name: true,
      timezone: true,
      maxActiveBookingsPerGuest: true,
      activeBookingIdentifyBy: true,
      maxConsecutiveBookingsPerGuest: true,
      notifications: {
        where: { kind: "CONFIRMATION", channel: { in: ["EMAIL", "TEXT"] }, enabled: true },
        select: { channel: true, template: true },
      },
    },
  });
  if (!location?.timezone) throw new Error("Location has no timezone");

  const startUTC = fromZonedTime(localStart, location.timezone);
  const endUTC = fromZonedTime(localEnd, location.timezone);

  // 3. Resolve bay
  let finalBayNumber: number;
  if (bayId) {
    const bay = await getPrisma().bay.findUnique({
      where: { id: bayId },
      select: { number: true, locationId: true },
    });
    if (!bay || bay.locationId !== locationId) throw new Error("Invalid bay");
    finalBayNumber = bay.number!;
  } else if (bayNumberInput != null) {
    const bay = await getPrisma().bay.findUnique({
      where: { locationId_number: { locationId, number: bayNumberInput } },
    });
    if (!bay) throw new Error("Bay not found");
    finalBayNumber = bay.number!;
  } else if (source === "PUBLIC") {
    finalBayNumber = await findAvailableBayForPublic({
      locationId,
      startUTC,
      endUTC,
      partyKind,
      handedness,
    });
    if (!finalBayNumber) throw new Error("No eligible bay available");
  } else {
    throw new Error("Admin must specify bayId or bayNumber");
  }

  // 4. Conflict check
  const conflict = await getPrisma().booking.findFirst({
    where: {
      locationId,
      bayNumber: finalBayNumber,
      canceledAt: null,
      AND: [{ start: { lt: endUTC } }, { end: { gt: startUTC } }],
    },
    select: { firstName: true, lastName: true, start: true, end: true },
  });
  if (conflict) {
    const name = `${conflict.firstName} ${conflict.lastName}`.trim();
    const time = `${conflict.start.toISOString()}–${conflict.end.toISOString()}`;
    throw new Error(`Booking overlaps with ${name} (${time})`);
  }

  // 5. Guest limits
  await enforceGuestLimits({
    location,
    guestEmail: email?.toLowerCase().trim() ?? null,
    guestPhone: phone?.trim() ?? null,
    startUTC,
    endUTC,
    bayNumber: finalBayNumber,
  });

  // 6. Create booking
  const token = crypto.randomBytes(16).toString("hex");
  const booking = await getPrisma().booking.create({
    data: {
      locationId,
      bayNumber: finalBayNumber,
      start: startUTC,
      end: endUTC,
      firstName,
      lastName: lastName ?? "",
      email: email?.toLowerCase().trim() ?? "",
      phone: phone?.trim() ?? "",
      managementToken: token,
    },
    select: {
      id: true,
      bayNumber: true,
      start: true,
      end: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      managementToken: true,
    },
  });

  // 7. Send confirmations
  await sendConfirmations({
    booking,
    locationName: location.name ?? "",
    notifications: location.notifications,
  });

  const manageUrl = `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/manage/${booking.id}?token=${token}`;

  return {
    id: booking.id,
    locationName: location.name ?? "",
    bayNumber: booking.bayNumber,
    start: booking.start,
    end: booking.end,
    firstName: booking.firstName,
    lastName: booking.lastName,
    email: booking.email,
    phone: booking.phone,
    manageUrl,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE BOOKING
// ─────────────────────────────────────────────────────────────────────────────
export type UpdateBookingInput = {
  bookingId: string;
  startLocal?: string;
  endLocal?: string;
  bayId?: string | null;
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
};

export async function updateBooking(input: UpdateBookingInput) {
  const { bookingId, startLocal, endLocal, bayId, firstName, lastName, email, phone } = input;

  const booking = await getPrisma().booking.findUnique({
    where: { id: bookingId },
    include: { location: { select: { id: true, timezone: true, name: true } } },
  });
  if (!booking) throw new Error("Booking not found");
  if (booking.canceledAt) throw new Error("Cannot update a canceled booking");

  const locationId = booking.locationId;
  const timezone = booking.location.timezone;

  let startUTC: Date | undefined;
  let endUTC: Date | undefined;
  let finalBayNumber: number | undefined = booking.bayNumber;

  if (startLocal && endLocal) {
    const cleanStart = startLocal.replace(/Z$/i, "").replace(/\.\d+$/, "");
    const cleanEnd = endLocal.replace(/Z$/i, "").replace(/\.\d+$/, "");
    const localStart = new Date(cleanStart);
    const localEnd = new Date(cleanEnd);
    if (isNaN(localStart.getTime()) || isNaN(localEnd.getTime()))
      throw new Error("Invalid date format");
    if (localEnd <= localStart)
      throw new Error("End must be after start");
    startUTC = fromZonedTime(localStart, timezone);
    endUTC = fromZonedTime(localEnd, timezone);
  }

  if (bayId !== undefined) {
    if (!bayId) throw new Error("bayId cannot be empty");
    const bay = await getPrisma().bay.findUnique({
      where: { id: bayId },
      select: { number: true, locationId: true },
    });
    if (!bay || bay.locationId !== locationId)
      throw new Error("Invalid bay");
    finalBayNumber = bay.number!;
  }

  if (startUTC || endUTC || finalBayNumber !== booking.bayNumber) {
    const checkStart = startUTC ?? booking.start;
    const checkEnd = endUTC ?? booking.end;
    const checkBay = finalBayNumber ?? booking.bayNumber;

    const conflict = await getPrisma().booking.findFirst({
      where: {
        locationId,
        bayNumber: checkBay,
        canceledAt: null,
        id: { not: bookingId },
        AND: [{ start: { lt: checkEnd } }, { end: { gt: checkStart } }],
      },
      select: { firstName: true, lastName: true, start: true, end: true },
    });
    if (conflict) {
      const name = `${conflict.firstName} ${conflict.lastName}`.trim();
      const time = `${conflict.start.toISOString()}–${conflict.end.toISOString()}`;
      throw new Error(`Updated time overlaps with ${name} (${time})`);
    }
  }

  const updated = await getPrisma().booking.update({
    where: { id: bookingId },
    data: {
      ...(startUTC && { start: startUTC }),
      ...(endUTC && { end: endUTC }),
      ...(finalBayNumber !== undefined && { bayNumber: finalBayNumber }),
      ...(firstName !== undefined && { firstName }),
      ...(lastName !== undefined && { lastName: lastName ?? "" }),
      ...(email !== undefined && { email: email?.toLowerCase().trim() ?? "" }),
      ...(phone !== undefined && { phone: phone?.trim() ?? "" }),
    },
  });

  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// CANCEL BOOKING
// ─────────────────────────────────────────────────────────────────────────────
export async function cancelBooking(bookingId: string) {
  const booking = await getPrisma().booking.findUnique({
    where: { id: bookingId },
  });
  if (!booking) throw new Error("Booking not found");
  if (booking.canceledAt) throw new Error("Booking already canceled");

  return await getPrisma().booking.update({
    where: { id: bookingId },
    data: { canceledAt: new Date() },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: Get all bookings for a day (in location timezone)
// ─────────────────────────────────────────────────────────────────────────────
export type AdminDayBooking = {
  id: string;
  bayId: string | null;
  bayNumber: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  start: string;
  end: string;
};

export type AdminDayView = {
  date: string;
  locationId: string;
  locationName: string;
  timezone: string;
  minBookingMinutes: number;
  bays: { id: string; number: number }[];
  bookings: AdminDayBooking[];
};

export async function getBookingsForAdminDay(
  locationSlug: string,
  dateISO: string
): Promise<AdminDayView> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
    throw new Error("Invalid date format. Use YYYY-MM-DD");
  }

  const location = await getPrisma().location.findUnique({
    where: { slug: locationSlug },
    select: {
      id: true,
      name: true,
      timezone: true,
      minBookingMinutes: true,
      bays: {
        select: { id: true, number: true },
        orderBy: { number: "asc" },
      },
    },
  });

  if (!location) throw new Error("Location not found");
  if (!location.timezone) throw new Error("Location has no timezone");

  const tz = location.timezone;

  const dayStartLocal = new Date(`${dateISO}T00:00:00`);
  const dayEndLocal = new Date(`${dateISO}T23:59:59.999`);

  const dayStartUtc = fromZonedTime(dayStartLocal, tz);
  const dayEndUtc = fromZonedTime(dayEndLocal, tz);

  const bookings = await getPrisma().booking.findMany({
    where: {
      locationId: location.id,
      canceledAt: null,
      start: { lt: dayEndUtc },
      end: { gt: dayStartUtc },
    },
    orderBy: { start: "asc" },
    select: {
      id: true,
      bayNumber: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      start: true,
      end: true,
    },
  });

  const formatted: AdminDayBooking[] = bookings.map((b) => {
    const bay = location.bays.find((bb) => bb.number === b.bayNumber);
    return {
      id: b.id,
      bayId: bay?.id ?? null,
      bayNumber: b.bayNumber,
      firstName: b.firstName,
      lastName: b.lastName,
      email: b.email,
      phone: b.phone,
      start: b.start.toISOString(),
      end: b.end.toISOString(),
    };
  });

  return {
    date: dateISO,
    locationId: location.id,
    locationName: location.name ?? "",
    timezone: location.timezone,
    minBookingMinutes: location.minBookingMinutes ?? 60,
    bays: location.bays.map((b) => ({ id: b.id, number: b.number })),
    bookings: formatted,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────
async function findAvailableBayForPublic({
  locationId,
  startUTC,
  endUTC,
  partyKind,
  handedness,
}: {
  locationId: string;
  startUTC: Date;
  endUTC: Date;
  partyKind: "SINGLE" | "GROUP";
  handedness?: "RH" | "LH";
}) {
  const bays = await getPrisma().bay.findMany({
    where: { locationId },
    select: { number: true, kind: true, handedness: true },
    orderBy: { number: "asc" },
  });

  const eligible = bays.filter((b) => {
    const kind = (b.kind as any) || "GROUP";
    if (partyKind === "GROUP") return kind === "GROUP";
    if (kind !== "SINGLE") return false;
    const h = (b.handedness as "RH" | "LH" | null) || "RH";
    return h === (handedness || "RH");
  });

  if (!eligible.length) return null;

  const occupied = await getPrisma().booking.findMany({
    where: {
      locationId,
      canceledAt: null,
      bayNumber: { in: eligible.map((b) => b.number) },
      NOT: [{ end: { lte: startUTC } }, { start: { gte: endUTC } }],
    },
    select: { bayNumber: true },
  });

  const taken = new Set(occupied.map((o) => o.bayNumber).filter(Boolean));
  const free = eligible.find((b) => !taken.has(b.number));
  return free?.number ?? null;
}

async function enforceGuestLimits({
  location,
  guestEmail,
  guestPhone,
  startUTC,
  endUTC,
  bayNumber,
}: {
  location: any;
  guestEmail: string | null;
  guestPhone: string | null;
  startUTC: Date;
  endUTC: Date;
  bayNumber: number;
}) {
  const identifyBy = (location.activeBookingIdentifyBy as IdentifyBy) || "EMAIL_OR_PHONE";
  const where: any = {};

  if (identifyBy === "EMAIL" && guestEmail) where.email = guestEmail;
  else if (identifyBy === "PHONE" && guestPhone) where.phone = guestPhone;
  else if (identifyBy === "EMAIL_OR_PHONE") {
    const ors: any[] = [];
    if (guestEmail) ors.push({ email: guestEmail });
    if (guestPhone) ors.push({ phone: guestPhone });
    if (ors.length) where.OR = ors;
  }

  if (Object.keys(where).length === 0) return;

  if (location.maxActiveBookingsPerGuest) {
    const active = await getPrisma().booking.count({
      where: { ...where, locationId: location.id, canceledAt: null, end: { gt: new Date() } },
    });
    if (active >= location.maxActiveBookingsPerGuest) {
      throw new Error(`Reservation limit reached: maximum ${location.maxActiveBookingsPerGuest} active bookings allowed`);
    }
  }

  if (location.maxConsecutiveBookingsPerGuest) {
    const neighbors = await getPrisma().booking.findMany({
      where: { ...where, locationId: location.id, bayNumber, canceledAt: null },
      select: { start: true, end: true },
      orderBy: { start: "asc" },
    });

    let chain = 1;
    let cursor = endUTC;
    while (true) {
      const next = neighbors.find((b) => Math.abs(new Date(b.start).getTime() - cursor.getTime()) <= 5 * 60_000);
      if (!next) break;
      chain++;
      cursor = new Date(next.end);
    }
    cursor = startUTC;
    while (true) {
      const prev = neighbors.find((b) => Math.abs(new Date(b.end).getTime() - cursor.getTime()) <= 5 * 60_000);
      if (!prev) break;
      chain++;
      cursor = new Date(prev.start);
    }

    if (chain > location.maxConsecutiveBookingsPerGuest) {
      throw new Error(`Consecutive booking limit exceeded (${chain} > ${location.maxConsecutiveBookingsPerGuest})`);
    }
  }
}

async function sendConfirmations({
  booking,
  locationName,
  notifications,
}: {
  booking: any;
  locationName: string;
  notifications: any[];
}) {
  const manageUrl = `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/manage/${booking.id}?token=${booking.managementToken}`;
  const vars = {
    firstName: booking.firstName ?? "",
    lastName: booking.lastName ?? "",
    email: booking.email ?? "",
    phone: booking.phone ?? "",
    date: formatDate(booking.start.toISOString()),
    startTime: formatTime(booking.start.toISOString()),
    endTime: formatTime(booking.end.toISOString()),
    bayNumber: booking.bayNumber ?? "—",
    locationName,
    manageUrl,
  };

  const emailTemplate = notifications.find((n) => n.channel === "EMAIL")?.template;
  const smsTemplate = notifications.find((n) => n.channel === "TEXT")?.template;

  if (emailTemplate && booking.email) {
    try {
      const html = renderTemplate(emailTemplate, vars).replace(/\n/g, "<br>");
      const subject = `Confirmed: ${locationName} — Bay ${vars.bayNumber} on ${vars.date} at ${vars.startTime}`;
      await sendEmail(booking.email, subject, html);
    } catch (e) {
      console.error("Email failed:", e);
    }
  }

  if (smsTemplate && booking.phone) {
    const phones = booking.phone.split(/[\s,]+/).map(normalizePhone).filter(Boolean);
    if (phones.length) {
      try {
        const text = renderTemplate(smsTemplate, vars);
        await sendSms({ from: process.env.OPENPHONE_FROM || "system", to: phones, content: text });
      } catch (e) {
        console.error("SMS failed:", e);
      }
    }
  }
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === "1") return `+${digits}`;
  if (digits.length >= 10 && raw.startsWith("+")) return raw.startsWith("+") ? raw : null;
  return null;
}