// app/api/bookings/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getPrisma } from "@/lib/db";
import { sendEmail } from "@/lib/sendEmail";
import { sendSms } from "@/lib/sendSms";
import { renderTemplate, formatDate, formatTime } from "@/lib/template";

export const dynamic = "force-dynamic";

/* ---------------- helpers ---------------- */
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

/** Convert newlines to <br> (preserves existing HTML like <strong>). */
function nl2brPreserveHtml(s: string) {
  return s.replace(/\r\n/g, "\n").split("\n").join("<br>");
}

/** Convert simple HTML to SMS-safe plaintext: <br>/<div>/<p> -> \n, strip other tags. */
function htmlToTextForSms(html: string) {
  return html
    .replace(/\r\n/g, "\n")
    .replace(/<(br|BR)\s*\/?>/g, "\n")
    .replace(/<\/(div|p)>/gi, "\n")
    .replace(/<(div|p)[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Strict E.164 check (+[1-9][0-9]{7,14}) */
function isE164(s: string) {
  return /^\+[1-9]\d{7,14}$/.test(s);
}

/** Normalize a single phone-ish string to E.164 (assume US +1 if 10 digits). */
function normalizePhoneE164One(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const only = raw.replace(/[^\d+]+/g, "");
  if (only.startsWith("+") && isE164(only)) return only;
  const digits = only.replace(/\+/g, "").replace(/[^\d]/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length > 10 && digits[0] === "1") return `+${digits}`;
  if (digits.length >= 8 && digits.length <= 15) {
    const candidate = `+${digits}`;
    return isE164(candidate) ? candidate : null;
  }
  return null;
}

/** Extract 0..N phones from any messy input, normalize to E.164, dedupe. */
function extractPhones(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const parts = String(raw)
    .replace(/[;\t]/g, " ")
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const norm = normalizePhoneE164One(p);
    if (norm && isE164(norm) && !out.includes(norm)) out.push(norm);
  }
  return out;
}

/** Mask helpers for logging */
function maskPhoneList(list: string[]): string {
  return list
    .map((p) => (p.length >= 6 ? `${p.slice(0, 3)}***${p.slice(-2)}` : "***"))
    .join(", ");
}

/* ---------------- POST: public booking create + confirmations ---------------- */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    // Inputs accepted from public form
    const locationSlug: string | undefined = body.locationSlug ?? body.slug;
    const locationIdBody: string | undefined = body.locationId;
    const bayId: string | null = body.bayId ?? body.bayID ?? null;
    const bayNumberRaw: any = body.bayNumber ?? body.bay_no ?? body.bay;
    const bayNumberParsed =
      bayNumberRaw === undefined || bayNumberRaw === null ? null : Number(bayNumberRaw);
    const hasBayNumber = bayNumberParsed !== null && !Number.isNaN(bayNumberParsed);
    const startISO: string | undefined =
      body.startISO ?? body.start ?? body.start_time ?? body.startTime;
    const endISO: string | undefined =
      body.endISO ?? body.end ?? body.end_time ?? body.endTime;
    const firstName: string | undefined = body.firstName;
    const lastName: string | undefined = body.lastName;
    const rawEmail: string | undefined = body.email;
    const rawPhoneAny: string | undefined =
      body.phone ??
      body.phoneNumber ??
      body.guestPhone ??
      body.guest_phone ??
      body.guest_phone_number ??
      body.contactPhone ??
      body.to;

    // Validate requireds
    if (!startISO || !endISO) {
      return badRequest("startISO and endISO are required");
    }
    const start = new Date(startISO);
    const end = new Date(endISO);
    if (Number.isNaN(start.getTime())) return badRequest("Invalid startISO");
    if (Number.isNaN(end.getTime())) return badRequest("Invalid endISO");
    if (end <= start) return badRequest("end must be after start");
    if (!firstName || typeof firstName !== "string") {
      return badRequest("firstName is required");
    }

    // Normalize email (DB requires string)
    const email = rawEmail ? String(rawEmail).trim() : null;
    const emailLower = email ? email.toLowerCase() : null;

    // Normalize phones
    const phones = extractPhones(rawPhoneAny ?? "");
    const phoneNorm = phones.length ? phones[0] : null;

    // -------- resolve location & bay --------
    let locationId: string | null = null;
    let bayNumber: number | null = null;

    if (bayId) {
      const bayRow = await getPrisma().bay.findUnique({
        where: { id: String(bayId) },
        select: { id: true, number: true, locationId: true },
      });
      if (!bayRow) return badRequest("Bay not found for given bayId");
      locationId = bayRow.locationId;
      bayNumber = bayRow.number ?? null;
    } else if (hasBayNumber) {
      let locId: string | null = null;
      if (locationIdBody) {
        locId = locationIdBody;
      } else if (locationSlug) {
        const loc = await getPrisma().location.findUnique({
          where: { slug: locationSlug },
          select: { id: true },
        });
        if (!loc) return badRequest("Location not found for given locationSlug");
        locId = loc.id;
      } else {
        return badRequest("locationSlug or locationId is required when using bayNumber");
      }
      const bayRow = await getPrisma().bay.findUnique({
        where: { locationId_number: { locationId: locId!, number: bayNumberParsed! } },
        select: { number: true, locationId: true },
      });
      if (!bayRow) return badRequest("Bay not found for given bayNumber at this location");
      locationId = bayRow.locationId;
      bayNumber = bayRow.number ?? null;
    } else {
      let locId: string | null = null;
      if (locationIdBody) {
        locId = locationIdBody;
      } else if (locationSlug) {
        const loc = await getPrisma().location.findUnique({
          where: { slug: locationSlug },
          select: { id: true },
        });
        if (!loc) return badRequest("Location not found for given locationSlug");
        locId = loc.id;
      } else {
        return badRequest("Provide locationSlug or locationId when bay is not specified");
      }
      const bays = await getPrisma().bay.findMany({
        where: { locationId: locId },
        select: { number: true },
        orderBy: [{ number: "asc" }],
      });
      if (!bays.length) return badRequest("No bays exist for this location");

      const conflicts = await getPrisma().booking.findMany({
        where: {
          locationId: locId,
          canceledAt: null,
          AND: [{ start: { lt: end } }, { end: { gt: start } }],
        },
        select: { bayNumber: true, start: true, end: true },
      });

      const occupied = new Set<number>();
      for (const e of conflicts) {
        if (e.bayNumber == null) continue;
        if (start < new Date(e.end) && end > new Date(e.start)) {
          occupied.add(e.bayNumber);
        }
      }
      const available = bays.find((b) => !occupied.has(b.number));
      if (!available) return badRequest("No available bays for the selected time window");
      locationId = locId;
      bayNumber = available.number ?? null;
    }

    if (!locationId || bayNumber == null) {
      return badRequest("Resolved location or bay could not be determined");
    }

    // Ensure selected bay/time is available
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

    // -------- create booking --------
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
        phone: (phoneNorm ?? body.phone ?? "") as string,
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

    // -------- confirmations --------
    // Fetch location name + enabled confirmation templates in ONE query
    const locationData = await getPrisma().location.findUnique({
      where: { id: created.locationId },
      select: {
        name: true,
        notifications: {
          where: {
            kind: "CONFIRMATION",
            channel: { in: ["EMAIL", "TEXT"] },
            enabled: true,
          },
          select: {
            channel: true,
            template: true,
          },
        },
      },
    });

    if (!locationData) {
      throw new Error("Location not found after booking creation");
    }

    const emailTemplate =
      locationData.notifications.find((n) => n.channel === "EMAIL")?.template ?? null;
    const smsTemplate =
      locationData.notifications.find((n) => n.channel === "TEXT")?.template ?? null;
    const locationName = locationData.name;

    const manageUrl = manageUrlFor(created.id, created.managementToken);
    const vars = {
      firstName: created.firstName ?? "",
      lastName: created.lastName ?? "",
      email: created.email ?? "",
      phone: created.phone ?? "",
      date: formatDate(created.start.toISOString()),
      startTime: formatTime(created.start.toISOString()),
      endTime: formatTime(created.end.toISOString()),
      bayNumber: created.bayNumber ?? "—",
      locationName: locationName ?? "",
      manageUrl,
    };

    // EMAIL confirmation (public)
    if (emailTemplate && created.email) {
      try {
        const rendered = renderTemplate(emailTemplate, vars);
        const html = nl2brPreserveHtml(rendered);
        const subject = `Confirmed: ${vars.locationName} — Bay ${vars.bayNumber} on ${vars.date} at ${vars.startTime}`;
        const res = await sendEmail(created.email, subject, html);
        if (!res.ok) console.error("Public sendEmail failed:", res.error);
      } catch (e) {
        console.error("Public email confirmation error:", e);
      }
    }

    // SMS confirmation (public)
    if (smsTemplate) {
      const finalTo = extractPhones(created.phone ?? "");
      if (finalTo.length) {
        try {
          const rendered = renderTemplate(smsTemplate, vars);
          const text = htmlToTextForSms(rendered);
          await sendSms({
            from: process.env.OPENPHONE_FROM || "system",
            to: finalTo,
            content: text,
          });
        } catch (e: any) {
          console.error(`Public SMS confirmation error (to:${maskPhoneList(finalTo)}):`, e);
        }
      } else {
        console.error("Public SMS confirmation skipped: no valid phone numbers.");
      }
    }

    return NextResponse.json({
      ok: true,
      booking: {
        id: created.id,
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
    console.error("Public booking create error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Internal error" },
      { status: 500 }
    );
  }
}