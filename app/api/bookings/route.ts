// app/api/bookings/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getPrisma } from "@/lib/db";
import { sendEmail } from "@/lib/sendEmail";
import { sendSms } from "@/lib/sendSms";
import { renderTemplate, formatDate, formatTime } from "@/lib/template";

export const dynamic = "force-dynamic";

/** Helpers */
function badRequest(msg: string, extra?: any) {
  return NextResponse.json({ ok: false, error: msg, ...extra }, { status: 400 });
}
function manageUrlFor(bookingId: string, token?: string | null) {
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.APP_BASE_URL ||
    process.env.BASE_URL ||
    "http://localhost:3000";
  const root = String(base).replace(/\/+$/, "");
  const id = encodeURIComponent(bookingId);
  const q = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${root}/manage/${id}${q}`;
}
function normalizePhoneE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (/^\+?\d{7,15}$/.test(raw)) return raw.startsWith("+") ? raw : `+${raw}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 11 && digits[0] === "1") return `+${digits}`;
  return null;
}
function isAdjacent(aEnd: Date, bStart: Date, toleranceMinutes = 5) {
  const diff = Math.abs(bStart.getTime() - aEnd.getTime());
  return diff <= toleranceMinutes * 60_000;
}

type IdentifyBy = "EMAIL" | "PHONE" | "EMAIL_OR_PHONE";

function buildGuestWhere(identifyBy: IdentifyBy, rawEmail?: string | null, rawPhone?: string | null) {
  const email = (rawEmail ?? "").trim();
  const emailLower = email ? email.toLowerCase() : "";
  const phone = normalizePhoneE164(rawPhone ?? null);

  if (identifyBy === "EMAIL") {
    if (!email) return { id: "__no_match__" } as any;
    return emailLower && emailLower !== email ? { OR: [{ email }, { email: emailLower }] } : { email };
  }
  if (identifyBy === "PHONE") return phone ? { phone } : ({ id: "__no_match__" } as any);

  const ors: any[] = [];
  if (email) {
    if (emailLower && emailLower !== email) ors.push({ email }, { email: emailLower });
    else ors.push({ email });
  }
  if (phone) ors.push({ phone });
  return ors.length ? { OR: ors } : ({ id: "__no_match__" } as any);
}

function nl2brPreserveHtml(s: string) {
  return s.replace(/\r\n/g, "\n").split("\n").join("<br>");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    // Inputs + aliases
    const bayId: string | null = body.bayId ?? body.bayID ?? null;
    const bayNumberRaw: any = body.bayNumber ?? body.bay_no ?? body.bay;
    const bayNumberParsed =
      bayNumberRaw === undefined || bayNumberRaw === null ? null : Number(bayNumberRaw);
    const hasBayNumber = bayNumberParsed !== null && !Number.isNaN(bayNumberParsed);

    const locationSlug: string | undefined = body.locationSlug ?? body.slug;
    const startISO: string | undefined = body.startISO ?? body.start ?? body.start_time ?? body.startTime;
    const endISO: string | undefined = body.endISO ?? body.end ?? body.end_time ?? body.endTime;

    const firstName: string | undefined = body.firstName;
    const lastName: string | undefined = body.lastName;
    const rawEmail: string | undefined = body.email;
    const rawPhone: string | undefined = body.phone;

    // Party hints (for auto bay selection)
    const partyKindRaw = String(body.partyKind ?? body.kind ?? "").toUpperCase();
    const partyKind: "SINGLE" | "GROUP" = partyKindRaw === "SINGLE" ? "SINGLE" : "GROUP";
    const handednessRaw = String(body.handedness ?? body.hand ?? "").toUpperCase();
    const handedness: "RH" | "LH" | undefined = partyKind === "SINGLE" ? (handednessRaw === "LH" ? "LH" : "RH") : undefined;

    if (!startISO || !endISO) return badRequest("startISO and endISO are required (aliases supported)");
    const start = new Date(startISO);
    const end = new Date(endISO);
    if (Number.isNaN(start.getTime())) return badRequest("Invalid startISO");
    if (Number.isNaN(end.getTime())) return badRequest("Invalid endISO");
    if (end <= start) return badRequest("end must be after start");

    if (!firstName || typeof firstName !== "string") return badRequest("firstName is required");

    const email = rawEmail ? String(rawEmail).trim() : null;
    const emailLower = email ? email.toLowerCase() : null;
    const phone = rawPhone ? String(rawPhone).trim() : null;
    const phoneNorm = normalizePhoneE164(phone);

    // Resolve location & bay
    let locationId: string | null = null;
    let bayNumber: number | null = null;

    if (bayId) {
      const bayRow = await getPrisma().bay.findUnique({
        where: { id: String(bayId) },
        select: { number: true, locationId: true },
      });
      if (!bayRow) return badRequest("Bay not found for given bayId");
      locationId = bayRow.locationId;
      bayNumber = bayRow.number ?? null;

      const clash = await getPrisma().booking.findFirst({
        where: {
          locationId,
          bayNumber,
          canceledAt: null,
          AND: [{ start: { lt: end } }, { end: { gt: start } }],
        },
        select: { id: true },
      });
      if (clash) return badRequest("Selected bay is not available for the requested time window");
    } else if (hasBayNumber) {
      if (!locationSlug) return badRequest("locationSlug is required when using bayNumber");
      const loc = await getPrisma().location.findUnique({ where: { slug: locationSlug }, select: { id: true } });
      if (!loc) return badRequest("Location not found for given locationSlug");

      const bayRow = await getPrisma().bay.findUnique({
        where: { locationId_number: { locationId: loc.id, number: bayNumberParsed! } },
        select: { number: true, locationId: true },
      });
      if (!bayRow) return badRequest("Bay not found for given bayNumber at this location");

      locationId = bayRow.locationId;
      bayNumber = bayRow.number;

      const clash = await getPrisma().booking.findFirst({
        where: {
          locationId,
          bayNumber,
          canceledAt: null,
          AND: [{ start: { lt: end } }, { end: { gt: start } }],
        },
        select: { id: true },
      });
      if (clash) return badRequest("Selected bay is not available for the requested time window");
    } else {
      // bay not specified => choose lowest-number eligible free bay
      if (!locationSlug || typeof locationSlug !== "string") {
        return badRequest("locationSlug is required when bay is not specified");
      }
      const loc = await getPrisma().location.findUnique({
        where: { slug: locationSlug },
        select: { id: true },
      });
      if (!loc) return badRequest("Location not found for given locationSlug");
      locationId = loc.id;

      const bays = await getPrisma().bay.findMany({
        where: { locationId: loc.id },
        select: { number: true, kind: true, handedness: true },
        orderBy: [{ number: "asc" }],
      });
      if (!bays.length) return badRequest("No bays exist for this location");

      const eligible = bays.filter((b) => {
        const k = (b.kind as "SINGLE" | "GROUP") || "GROUP";
        if (partyKind === "GROUP") return k === "GROUP";
        if (k !== "SINGLE") return false;
        const h = ((b.handedness as "RH" | "LH" | null) || "RH");
        return h === (handedness || "RH");
      });
      if (!eligible.length) return badRequest("No eligible bays for the requested party type");

      const overlaps = await getPrisma().booking.findMany({
        where: {
          locationId: loc.id,
          canceledAt: null,
          bayNumber: { in: eligible.map((b) => b.number) },
          NOT: [{ end: { lte: start } }, { start: { gte: end } }],
        },
        select: { bayNumber: true },
      });
      const occupied = new Set(overlaps.map((o) => o.bayNumber).filter((n): n is number => n != null));
      const free = eligible.find((b) => !occupied.has(b.number));
      if (!free) return badRequest("No bay free for the selected time window");

      bayNumber = free.number ?? null;
    }

    if (!locationId || bayNumber == null) return badRequest("Resolved location or bay could not be determined");

    // Load location settings (incl. name for templates/response)
    const locSettings = await getPrisma().location.findUnique({
      where: { id: locationId },
      select: {
        id: true,
        name: true,
        emailTemplate: true,
        smsTemplate: true,
        maxActiveBookingsPerGuest: true,
        activeBookingIdentifyBy: true,
        maxConsecutiveBookingsPerGuest: true,
        minBookingMinutes: true,
      },
    });
    if (!locSettings) return badRequest("Location settings not found");

    const identifyBy: IdentifyBy =
      (locSettings.activeBookingIdentifyBy as IdentifyBy) || "EMAIL_OR_PHONE";
    const guestWhere = buildGuestWhere(identifyBy, email, phone);

    // Max active bookings / guest
    if (locSettings.maxActiveBookingsPerGuest && locSettings.maxActiveBookingsPerGuest > 0) {
      const now = new Date();
      const activeCount = await getPrisma().booking.count({
        where: { locationId, canceledAt: null, end: { gt: now }, ...guestWhere },
      });
      if (activeCount >= locSettings.maxActiveBookingsPerGuest) {
        return badRequest(
          `Reservation limit reached: You already have ${activeCount} active booking${
            activeCount === 1 ? "" : "s"
          }. The maximum allowed is ${locSettings.maxActiveBookingsPerGuest}.`
        );
      }
    }

    // Max consecutive bookings / guest (same bay, back-to-back)
    if (locSettings.maxConsecutiveBookingsPerGuest && locSettings.maxConsecutiveBookingsPerGuest > 0) {
      const neighbors = await getPrisma().booking.findMany({
        where: { locationId, bayNumber, canceledAt: null, ...guestWhere },
        select: { id: true, start: true, end: true },
        orderBy: [{ start: "asc" }],
      });

      let leftChain = 0;
      let rightChain = 0;

      let leftCursor = new Date(start);
      while (true) {
        const prev = neighbors.find((b) => isAdjacent(new Date(b.end), leftCursor));
        if (!prev) break;
        leftChain += 1;
        leftCursor = new Date(prev.start);
        const idx = neighbors.findIndex((b) => b.id === prev.id);
        if (idx >= 0) neighbors.splice(idx, 1);
      }

      let rightCursor = new Date(end);
      while (true) {
        const next = neighbors.find((b) => isAdjacent(rightCursor, new Date(b.start)));
        if (!next) break;
        rightChain += 1;
        rightCursor = new Date(next.end);
        const idx = neighbors.findIndex((b) => b.id === next.id);
        if (idx >= 0) neighbors.splice(idx, 1);
      }

      const chainLen = 1 + leftChain + rightChain;
      if (chainLen > locSettings.maxConsecutiveBookingsPerGuest) {
        return badRequest(
          `Reservation limit reached: This would create ${chainLen} consecutive back-to-back bookings on Bay ${bayNumber}. The maximum consecutive reservations allowed is ${locSettings.maxConsecutiveBookingsPerGuest}.`
        );
      }
    }

    // ✅ Create booking (no nulls for required strings)
    const managementToken = crypto.randomBytes(16).toString("hex");
    const created = await getPrisma().booking.create({
      data: {
        locationId,
        bayNumber,
        start,
        end,
        firstName: String(firstName),
        lastName: lastName ? String(lastName) : "",
        email: emailLower ?? "",
        phone: phoneNorm ?? phone ?? "",
        managementToken,
      },
      select: {
        id: true,
        locationId: true,
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

    const manageUrl = manageUrlFor(created.id, created.managementToken);
    const locationName = locSettings.name ?? "";

    // Templates
    const [confirmEmailRow, confirmTextRow] = await Promise.all([
      getPrisma().notification.findFirst({
        where: { locationId: created.locationId, kind: "CONFIRMATION", channel: "EMAIL", enabled: true },
        select: { template: true },
      }),
      getPrisma().notification.findFirst({
        where: { locationId: created.locationId, kind: "CONFIRMATION", channel: "TEXT", enabled: true },
        select: { template: true },
      }),
    ]);

    const emailTemplate = confirmEmailRow?.template ?? locSettings.emailTemplate ?? null;
    const smsTemplate = confirmTextRow?.template ?? locSettings.smsTemplate ?? null;

    const vars = {
      firstName: created.firstName ?? "",
      lastName: created.lastName ?? "",
      email: created.email ?? "",
      phone: created.phone ?? "",
      date: formatDate(created.start.toISOString()),
      startTime: formatTime(created.start.toISOString()),
      endTime: formatTime(created.end.toISOString()),
      bayNumber: created.bayNumber ?? "—",
      locationName,
      manageUrl,
    };

    if (emailTemplate && created.email) {
      try {
        const rendered = renderTemplate(emailTemplate, vars);
        const html = nl2brPreserveHtml(rendered);
        const subject = `Confirmed: ${vars.locationName} — Bay ${vars.bayNumber} on ${vars.date} at ${vars.startTime}`;
        const res = await sendEmail(created.email, subject, html);
        if (!res.ok) console.error("sendEmail failed:", res.error);
      } catch (e) {
        console.error("Email confirmation error:", e);
      }
    }

    if (smsTemplate && created.phone) {
      const to = normalizePhoneE164(created.phone);
      if (to) {
        try {
          const text = renderTemplate(smsTemplate, vars);
          await sendSms({ from: process.env.OPENPHONE_FROM || "system", to: [to], content: text });
        } catch (e) {
          console.error("SMS confirmation error:", e);
        }
      } else {
        console.error("SMS confirmation skipped: invalid phone", created.phone);
      }
    }

    return NextResponse.json({
      ok: true,
      booking: {
        id: created.id,
        locationName,
        bayNumber: created.bayNumber,
        start: created.start,
        end: created.end,
        firstName: created.firstName,
        lastName: created.lastName,
        email: created.email,
        phone: created.phone,
        manageUrl,
      },
    });
  } catch (err: any) {
    console.error("Booking create error:", err);
    return NextResponse.json({ ok: false, error: err?.message || "Internal error" }, { status: 500 });
  }
}


