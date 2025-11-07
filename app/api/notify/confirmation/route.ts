// app/api/notify/confirmation/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { sendEmail } from "@/lib/sendEmail";
import { sendSms } from "@/lib/sendSms";
import { renderTemplate } from "@/lib/template";
import { buildTemplateVars, MERGE_FIELDS, BookingContext } from "@/lib/template-vars";

export const dynamic = "force-dynamic";

// Build absolute base URL
function getBaseUrl(req: NextRequest): string {
  const envBase =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.APP_BASE_URL ||
    process.env.BASE_URL;
  if (envBase) return envBase.replace(/\/+$/, "");
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const host = req.headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

function ensureManageLinkInEmail(html: string, manageUrl: string): string {
  if (!manageUrl || html.includes(manageUrl)) return html;
  const footer = `<br><br><div style="font-size:12px;color:#555">Manage: <a href="${manageUrl}">${manageUrl}</a></div>`;
  return html.trim() + footer;
}

function ensureManageLinkInText(text: string, manageUrl: string): string {
  if (!manageUrl || text.includes(manageUrl)) return text;
  return (text.trim() + `\nManage: ${manageUrl}`).trim();
}

// US-biased E.164 normalizer
function normalizePhoneE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (/^\+?\d{7,15}$/.test(raw)) return raw.startsWith("+") ? raw : `+${raw}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 11 && digits[0] === "1") return `+${digits}`;
  return null;
}

function getSmsFrom(): string | undefined {
  return process.env.OPENPHONE_NUMBER || process.env.SMS_FROM || process.env.DEFAULT_FROM || undefined;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const bookingId = String(body?.bookingId || "").trim();
    if (!bookingId) {
      return NextResponse.json({ error: "bookingId is required" }, { status: 400 });
    }

    // Load booking + location
    const booking = await getPrisma().booking.findUnique({
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
    const manageUrl = `${base}/manage/${booking.id}?token=${encodeURIComponent(booking.managementToken)}`;

    // Build context for template vars
    const ctx: BookingContext = {
      bookingId: booking.id,
      managementToken: booking.managementToken,
      startISO: booking.start.toISOString(),
      endISO: booking.end.toISOString(),
      firstName: booking.firstName,
      lastName: booking.lastName,
      email: booking.email,
      phone: booking.phone,
      bayNumber: booking.bayNumber,
      locationName: booking.Location.name,
      locationSlug: booking.Location.slug,
      manageUrl, // optional: will be recomputed if missing
    };

    const vars = buildTemplateVars(ctx);

    // Pull confirmation templates (hoursBefore = 0)
    const rows = await getPrisma().notification.findMany({
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
        const subject = `Your Tee24 booking • Bay ${booking.bayNumber ?? "—"} at ${booking.Location.name}`;
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
            await sendSms({ from, to: [normalized], content: text });
            sms = true;
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
        aliasesProvided: Object.keys(MERGE_FIELDS.aliases),
        mergeFields: MERGE_FIELDS,
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