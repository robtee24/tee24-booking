// lib/send-confirmations.ts
import { prisma } from "@/lib/prisma";
import { renderTemplate, formatDate, formatTime } from "@/lib/template";
import { sendEmail } from "@/lib/sendEmail";
import { sendSms } from "@/lib/sendSms";

/**
 * Build an absolute base URL like the API routes do.
 */
function getBaseUrl() {
  const envBase =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.APP_BASE_URL ||
    process.env.BASE_URL;
  return (envBase ? envBase : "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * Sender number for SMS (OpenPhone/Twilio/etc).
 * Set one of these in your env: OPENPHONE_FROM or SMS_FROM.
 */
function getSmsFrom(): string {
  const from =
    process.env.OPENPHONE_FROM ||
    process.env.SMS_FROM ||
    process.env.OPENPHONE_NUMBER || // if you already use this name elsewhere
    "";
  if (!from) {
    throw new Error(
      "Missing SMS sender number. Set OPENPHONE_FROM or SMS_FROM in your environment."
    );
  }
  return from;
}

/**
 * Normalize to (very) basic E.164.
 */
function normalizePhoneE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (/^\+?\d{7,15}$/.test(raw)) return raw.startsWith("+") ? raw : `+${raw}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/**
 * Append a "Manage" link to HTML if it isn't there.
 */
function ensureManageLinkInEmail(html: string, manageUrl: string) {
  if (!manageUrl || html.includes(manageUrl)) return html;
  const footer =
    `<br><br><div style="font-size:12px;color:#555">Manage: ` +
    `<a href="${manageUrl}">${manageUrl}</a></div>`;
  return html.trim() + footer;
}

/**
 * Append a "Manage" link to plain text if it isn't there.
 */
function ensureManageLinkInText(text: string, manageUrl: string) {
  if (!manageUrl || text.includes(manageUrl)) return text;
  return (text.trim() + `\nManage: ${manageUrl}`).trim();
}

/**
 * Send the confirmation (email/text) for a specific booking.
 * Mirrors the field names used elsewhere in the app:
 *  - Booking.start / Booking.end (Date)
 *  - Booking.bayNumber (number | null)
 *  - Booking.Location (relation)
 *  - Booking.managementToken (string | null)
 */
export async function sendConfirmationForBooking(bookingId: string) {
  // Load booking + required relations with correct field names.
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
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
      Location: { select: { id: true, name: true, slug: true } },
    },
  });

  if (!booking || !booking.Location) {
    return { ok: false, error: "Booking not found" as const };
  }

  const base = getBaseUrl();
  const manageUrl = `${base}/manage/${booking.id}?token=${encodeURIComponent(
    booking.managementToken || ""
  )}`;

  // Vars (provide both start/end and startTime/endTime aliases)
  const startISO = booking.start.toISOString();
  const endISO = booking.end.toISOString();
  const startStr = formatTime(startISO);
  const endStr = formatTime(endISO);

  const vars = {
    firstName: booking.firstName,
    lastName: booking.lastName,
    phone: booking.phone,
    email: booking.email,
    locationName: booking.Location.name,
    bayNumber: booking.bayNumber ?? "—",
    date: formatDate(startISO),
    start: startStr,
    end: endStr,
    startTime: startStr,
    endTime: endStr,
    manageUrl,
    bookingNote: "",
  };

  // Pull enabled confirmation templates (hoursBefore=0) for this location.
  const rows = await prisma.notification.findMany({
    where: {
      locationId: booking.locationId,
      kind: "CONFIRMATION",
      hoursBefore: 0,
      enabled: true,
    },
    select: { id: true, channel: true, template: true, order: true },
    orderBy: [{ channel: "asc" }, { order: "asc" }, { id: "asc" }],
  });

  const firstEmail = rows.find((r) => r.channel === "EMAIL");
  const firstText = rows.find((r) => r.channel === "TEXT");

  let emailSent = false;
  let emailError: string | null = null;

  if (firstEmail && booking.email) {
    const rawHtml = renderTemplate(firstEmail.template || "", vars).trim();
    if (rawHtml) {
      const html = ensureManageLinkInEmail(rawHtml, manageUrl);
      const subject = `Your Tee24 booking • Bay ${booking.bayNumber ?? "—"} at ${
        booking.Location.name
      }`;
      try {
        const res = await sendEmail(booking.email, subject, html);
        emailSent = !!res.ok;
        if (!res.ok) emailError = res.error || "Unknown email send error";
      } catch (e: any) {
        emailError = e?.message || "Email send failed";
      }
    }
  }

  let smsSent = false;
  let smsError: string | null = null;

  if (firstText && booking.phone) {
    const normalized = normalizePhoneE164(booking.phone);
    const rawText = renderTemplate(firstText.template || "", vars).trim();
    if (!normalized) {
      smsError = "Invalid phone (unable to normalize to E.164)";
    } else if (rawText) {
      const text = ensureManageLinkInText(rawText, manageUrl);
      try {
        const from = getSmsFrom();
        await sendSms({ from, to: [normalized], content: text });
        smsSent = true;
      } catch (e: any) {
        smsError = e?.message || "SMS send failed";
      }
    }
  }

  return {
    ok: true as const,
    email: emailSent,
    sms: smsSent,
    emailError,
    smsError,
    meta: {
      foundEmailTemplate: !!firstEmail,
      foundTextTemplate: !!firstText,
      aliasesProvided: ["start", "startTime", "end", "endTime"],
      manageUrlIncluded: true,
    },
  };
}
