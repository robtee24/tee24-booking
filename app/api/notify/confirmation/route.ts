// app/api/notify/confirmation/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/sendEmail";
import { sendSms } from "@/lib/sendSms";
import { renderTemplate, formatDate, formatTime } from "@/lib/template";

export const dynamic = "force-dynamic";

// Build absolute base URL
function getBaseUrl(req: NextRequest) {
  const envBase =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.APP_BASE_URL ||
    process.env.BASE_URL;
  if (envBase) return envBase.replace(/\/+$/, "");
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const host = req.headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

function ensureManageLinkInEmail(html: string, manageUrl: string) {
  if (!manageUrl || html.includes(manageUrl)) return html;
  const footer =
    `<br><br><div style="font-size:12px;color:#555">Manage: ` +
    `<a href="${manageUrl}">${manageUrl}</a></div>`;
  return html.trim() + footer;
}

function ensureManageLinkInText(text: string, manageUrl: string) {
  if (!manageUrl || text.includes(manageUrl)) return text;
  return (text.trim() + `\nManage: ${manageUrl}`).trim();
}

// Very simple US-biased normalizer.
// - If 10 digits, assume US and prepend +1
// - If 11+ and starts with 1, prepend +
// - If already +E164-ish, keep it
function normalizePhoneE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (/^\+?\d{7,15}$/.test(raw)) {
    return raw.startsWith("+") ? raw : `+${raw}`;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 11 && digits[0] === "1") return `+${digits}`;
  return null;
}

// Choose a default "from" number for SMS (adjust env names to your setup)
function getSmsFrom(): string | undefined {
  return (
    process.env.OPENPHONE_NUMBER ||
    process.env.SMS_FROM ||
    process.env.DEFAULT_FROM ||
    undefined
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const bookingId = String(body?.bookingId || "").trim();
    if (!bookingId) {
      return NextResponse.json({ error: "bookingId is required" }, { status: 400 });
    }

    // Load booking + location
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
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const base = getBaseUrl(req);
    const manageUrl = `${base}/manage/${booking.id}?token=${encodeURIComponent(
      booking.managementToken
    )}`;

    // Provide BOTH alias sets so {{start}} or {{startTime}} work.
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
      bayNumber: booking.bayNumber,
      date: formatDate(startISO),
      start: startStr,
      end: endStr,
      startTime: startStr,
      endTime: endStr,
      manageUrl,
      bookingNote: "",
    };

    // Pull ONLY confirmation rows (hoursBefore = 0), dedupe by channel
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

    // EMAIL
    let email = false;
    let emailError: string | null = null;
    if (firstEmail && booking.email) {
      const rawHtml = renderTemplate(firstEmail.template || "", vars).trim();
      if (rawHtml) {
        const html = ensureManageLinkInEmail(rawHtml, manageUrl);
        const subject = `Your Tee24 booking • Bay ${booking.bayNumber} at ${booking.Location.name}`;
        try {
          const res = await sendEmail(booking.email, subject, html);
          email = !!res.ok;
          if (!res.ok) emailError = res.error || "Unknown email send error";
        } catch (e: any) {
          emailError = e?.message || "Email send failed";
        }
      }
    }

    // TEXT
    let sms = false;
    let smsError: string | null = null;
    if (firstText && booking.phone) {
      const normalized = normalizePhoneE164(booking.phone);
      const rawText = renderTemplate(firstText.template || "", vars).trim();

      if (!normalized) {
        smsError = "Invalid phone (unable to normalize to E.164)";
      } else if (!rawText) {
        // no-op: empty template
      } else {
        const text = ensureManageLinkInText(rawText, manageUrl);
        const from = getSmsFrom();
        if (!from) {
          smsError = "Missing SMS 'from' number in environment configuration";
        } else {
          try {
            // New canonical signature: { from, to: string[], content }
            await sendSms({ from, to: [normalized], content: text });
            sms = true; // success if no error thrown
          } catch (e: any) {
            smsError = e?.message || "SMS send failed";
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      email,
      sms,
      emailError,
      smsError,
      meta: {
        foundEmailTemplate: !!firstEmail,
        foundTextTemplate: !!firstText,
        aliasesProvided: ["start", "startTime", "end", "endTime"],
        manageUrlIncluded: true,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}

