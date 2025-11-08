// app/api/cron/send-reminders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { sendEmail } from "@/lib/sendEmail";
import { sendSms } from "@/lib/sendSms";
import { renderTemplate } from "@/lib/template";
import { buildTemplateVars, BookingContext } from "@/lib/template-vars";

export const dynamic = "force-dynamic";

type DueItem = {
  bookingId: string;
  managementToken: string | null;
  notificationId: string;
  locationSlug: string;
  locationName: string;
  channel: "EMAIL" | "TEXT";
  offsetHours: number;
  startISO: string;
  endISO: string;
  bayNumber: number | null;
  guestFirst?: string | null;
  guestLast?: string | null;
  guestEmail?: string | null;
  guestPhone?: string | null;
  template?: string | null;
};

// === HELPER: Add hours correctly (no mutation) ===
function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

// === HELPER: Round to minute (no mutation) ===
function roundToMinute(d: Date): Date {
  const copy = new Date(d);
  copy.setSeconds(0, 0);
  return copy;
}

function manageUrlFor(bookingId: string, token?: string | null): string {
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

function htmlifyPreservingTags(tpl: string): string {
  if (/<[a-z][\s\S]*>/i.test(tpl)) {
    return tpl.replace(/\r\n/g, "\n").replace(/\n/g, "<br>");
  }
  return tpl
    .replace(/\r\n/g, "\n")
    .replace(/\n\n+/g, "<br><br>")
    .replace(/\n/g, "<br>");
}

// === DEBUG UTILITY ===
const DEBUG = (msg: string, ...args: any[]) => {
  if (process.env.NODE_ENV !== "production" || process.env.DEBUG_CRON === "true") {
    console.debug(`[SEND-REMINDERS] ${msg}`, ...args);
  }
};

// === PHASE 1: FIND & QUEUE DUE NOTIFICATIONS ===
async function queueDueNotifications(
  now: Date,
  windowMinutes: number,
  onlyBookingId?: string | null,
  onlyChannel?: "EMAIL" | "TEXT" | null,
  dryRun = false
): Promise<{ queued: number; skipped: number; due: DueItem[] }> {
  const due = await findDueNotifications(now, windowMinutes, onlyBookingId, onlyChannel);
  let queued = 0;
  let skipped = 0;

  for (const item of due) {
    const already = await getPrisma().notificationLog.findUnique({
      where: {
        bookingId_notificationId_channel: {
          bookingId: item.bookingId,
          notificationId: item.notificationId,
          channel: item.channel,
        },
      },
    });

    if (already) {
      DEBUG(`SKIP: already logged ${item.bookingId}/${item.notificationId}/${item.channel}`);
      skipped++;
      continue;
    }

    if (dryRun) {
      DEBUG(`DRY-RUN: queue ${item.bookingId}/${item.notificationId}/${item.channel}`);
      await getPrisma().notificationLog.create({
        data: {
          bookingId: item.bookingId,
          notificationId: item.notificationId,
          channel: item.channel,
          status: "DRY-RUN",
          providerId: null,
          error: null,
        },
      });
      queued++;
      continue;
    }

    await getPrisma().notificationLog.create({
      data: {
        bookingId: item.bookingId,
        notificationId: item.notificationId,
        channel: item.channel,
        status: "UNSENT",
        providerId: null,
        error: null,
      },
    });

    DEBUG(`QUEUED: ${item.bookingId}/${item.notificationId}/${item.channel}`);
    queued++;
  }

  return { queued, skipped, due };
}

// === PHASE 2: SEND ALL UNSENT (NO TIME WINDOW) ===
async function sendAllUnsent(): Promise<Array<{
  bookingId: string;
  notificationId: string;
  channel: string;
  ok: boolean;
  skipped?: string;
  error?: string;
  simulatedNow?: string;
}>> {
  const now = new Date();

  const unsent = await getPrisma().notificationLog.findMany({
    where: { status: "UNSENT" },
    include: {
      booking: {
        select: {
          id: true,
          start: true,
          end: true,
          bayNumber: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          managementToken: true,
          location: { select: { slug: true, name: true } },
        },
      },
      notification: {
        select: { template: true, channel: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  DEBUG(`Found ${unsent.length} UNSENT logs to send`);

  const attempts: Array<{
    bookingId: string;
    notificationId: string;
    channel: string;
    ok: boolean;
    skipped?: string;
    error?: string;
    simulatedNow?: string;
  }> = [];

  for (const log of unsent) {
    const b = log.booking;
    const n = log.notification;

    const ctx: BookingContext = {
      bookingId: b.id,
      managementToken: b.managementToken ?? null,
      startISO: b.start.toISOString(),
      endISO: b.end.toISOString(),
      firstName: b.firstName ?? null,
      lastName: b.lastName ?? null,
      email: b.email ?? null,
      phone: b.phone ?? null,
      bayNumber: b.bayNumber ?? null,
      locationName: b.location.name,
      locationSlug: b.location.slug,
      manageUrl: manageUrlFor(b.id, b.managementToken ?? undefined),
    };
    const vars = buildTemplateVars(ctx);

    // === SEND EMAIL ===
    if (n.channel === "EMAIL") {
      if (!b.email) {
        await getPrisma().notificationLog.update({
          where: { id: log.id },
          data: { status: "FAILED", error: "Missing guestEmail" },
        });
        attempts.push({
          bookingId: b.id,
          notificationId: n.id,
          channel: "EMAIL",
          ok: false,
          error: "Missing guestEmail",
          simulatedNow: now.toISOString(),
        });
        continue;
      }

      try {
        const body = renderTemplate(n.template ?? "", vars);
        const html = htmlifyPreservingTags(body);
        const subject = `Reminder: ${vars.locationName} — Bay ${vars.bayNumber} at ${vars.startTime}`;
        const res = await sendEmail(b.email, subject, html);

        if (res.ok) {
          await getPrisma().notificationLog.update({
            where: { id: log.id },
            data: { status: "SENT", providerId: res.id ?? null, error: null },
          });
          attempts.push({
            bookingId: b.id,
            notificationId: n.id,
            channel: "EMAIL",
            ok: true,
            simulatedNow: now.toISOString(),
          });
        } else {
          await getPrisma().notificationLog.update({
            where: { id: log.id },
            data: { status: "FAILED", error: res.error || "email send failed" },
          });
          attempts.push({
            bookingId: b.id,
            notificationId: n.id,
            channel: "EMAIL",
            ok: false,
            error: res.error || "email send failed",
            simulatedNow: now.toISOString(),
          });
        }
      } catch (err: any) {
        await getPrisma().notificationLog.update({
          where: { id: log.id },
          data: { status: "FAILED", error: err?.message || "email threw" },
        });
        attempts.push({
          bookingId: b.id,
          notificationId: n.id,
          channel: "EMAIL",
          ok: false,
          error: err?.message || "email threw",
          simulatedNow: now.toISOString(),
        });
      }
    }

    // === SEND SMS ===
    else {
      const normalized = normalizePhoneE164(b.phone);
      if (!normalized) {
        await getPrisma().notificationLog.update({
          where: { id: log.id },
          data: { status: "FAILED", error: "Invalid recipient number" },
        });
        attempts.push({
          bookingId: b.id,
          notificationId: n.id,
          channel: "TEXT",
          ok: false,
          error: "Invalid recipient number",
          simulatedNow: now.toISOString(),
        });
        continue;
      }

      try {
        const text = renderTemplate(n.template ?? "", vars);
        await sendSms({
          from: process.env.OPENPHONE_FROM || "system",
          to: [normalized],
          content: text,
        });

        await getPrisma().notificationLog.update({
          where: { id: log.id },
          data: { status: "SENT", providerId: null, error: null },
        });

        attempts.push({
          bookingId: b.id,
          notificationId: n.id,
          channel: "TEXT",
          ok: true,
          simulatedNow: now.toISOString(),
        });
      } catch (err: any) {
        await getPrisma().notificationLog.update({
          where: { id: log.id },
          data: { status: "FAILED", error: err?.message || "sms threw" },
        });
        attempts.push({
          bookingId: b.id,
          notificationId: n.id,
          channel: "TEXT",
          ok: false,
          error: err?.message || "sms threw",
          simulatedNow: now.toISOString(),
        });
      }
    }
  }

  return attempts;
}

// === ORIGINAL findDueNotifications (100% unchanged) ===
async function findDueNotifications(
  now: Date,
  windowMinutes: number,
  onlyBookingId?: string | null,
  onlyChannel?: "EMAIL" | "TEXT" | null
): Promise<DueItem[]> {
  const notifications = await getPrisma().notification.findMany({
    where: { kind: "NOTIFICATION", enabled: true, hoursBefore: { gt: 0 } },
    select: {
      id: true,
      locationId: true,
      channel: true,
      hoursBefore: true,
      template: true,
      order: true,
      location: { select: { id: true, slug: true, name: true } },
    },
    orderBy: [
      { hoursBefore: "asc" },
      { channel: "asc" },
      { order: "asc" },
      { id: "asc" },
    ],
  });

  if (notifications.length === 0) return [];

  const byLocation = new Map<string, typeof notifications>();
  for (const n of notifications) {
    if (!n.location) continue;
    const arr = byLocation.get(n.location.id) ?? [];
    arr.push(n);
    byLocation.set(n.location.id, arr);
  }

  const nowRounded = roundToMinute(now);
  const results: DueItem[] = [];

  for (const [locationId, list] of byLocation.entries()) {
    const loc = list[0].location!;
    const minHours = Math.min(...list.map((n) => n.hoursBefore));
    const maxHours = Math.max(...list.map((n) => n.hoursBefore));

    const earliestTarget = addHours(nowRounded, minHours);
    const latestTarget = addHours(nowRounded, maxHours);
    const broadStart = new Date(earliestTarget);
    broadStart.setMinutes(broadStart.getMinutes() - windowMinutes);
    const broadEnd = new Date(latestTarget);
    broadEnd.setMinutes(broadEnd.getMinutes() + windowMinutes);

    const bookings = await getPrisma().booking.findMany({
      where: {
        locationId,
        ...(onlyBookingId ? { id: onlyBookingId } : {}),
        start: { gte: broadStart, lte: broadEnd },
      },
      select: {
        id: true,
        start: true,
        end: true,
        bayNumber: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        managementToken: true,
      },
      orderBy: [{ start: "asc" }],
    });

    for (const n of list) {
      if (onlyChannel && n.channel !== onlyChannel) continue;
      const target = addHours(nowRounded, n.hoursBefore);
      const windowStart = new Date(target);
      windowStart.setMinutes(windowStart.getMinutes() - windowMinutes);
      const windowEnd = new Date(target);
      windowEnd.setMinutes(windowEnd.getMinutes() + windowMinutes);

      for (const b of bookings) {
        if (b.start >= windowStart && b.start <= windowEnd) {
          results.push({
            bookingId: b.id,
            managementToken: b.managementToken ?? null,
            notificationId: n.id,
            locationSlug: loc.slug,
            locationName: loc.name,
            channel: n.channel as "EMAIL" | "TEXT",
            offsetHours: n.hoursBefore,
            startISO: b.start.toISOString(),
            endISO: b.end.toISOString(),
            bayNumber: b.bayNumber ?? null,
            guestFirst: b.firstName ?? "",
            guestLast: b.lastName ?? "",
            guestEmail: b.email ?? null,
            guestPhone: b.phone ?? null,
            template: n.template ?? "",
          });
        }
      }
    }
  }

  return results;
}

// === MAIN HANDLER ===
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // === AUTHENTICATION ===
    const authHeader = req.headers.get("authorization");
    const querySecret = searchParams.get("secret");
    let secret: string | null = null;
    if (authHeader?.startsWith("Bearer ")) {
      secret = authHeader.split(" ")[1];
    } else if (querySecret) {
      secret = querySecret;
    }

    if (!process.env.CRON_SECRET) {
      return NextResponse.json(
        { ok: false, error: "Missing CRON_SECRET in env" },
        { status: 500 }
      );
    }
    if (!secret || secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // === PARAMETERS ===
    const dryRun = searchParams.get("dryRun") === "true";
    const nowParam = searchParams.get("now");
    const windowParam = searchParams.get("window");
    const onlyBookingId = searchParams.get("bookingId") || undefined;
    const onlyChannel = (searchParams.get("channel") as "EMAIL" | "TEXT" | null) ?? null;
    const debug = searchParams.get("debug") === "true";

    if (debug) process.env.DEBUG_CRON = "true";

    const now = nowParam ? new Date(nowParam) : new Date();
    const windowMinutes = windowParam ? Math.max(1, Number(windowParam)) : 5;

    DEBUG(`START: now=${now.toISOString()}, window=${windowMinutes}min, dryRun=${dryRun}`);

    // === PHASE 1: QUEUE DUE NOTIFICATIONS ===
    const { queued, skipped, due } = await queueDueNotifications(
      now,
      windowMinutes,
      onlyBookingId,
      onlyChannel,
      dryRun
    );

    // === PHASE 2: SEND ALL UNSENT (NO WINDOW) ===
    const sendAttempts = dryRun ? [] : await sendAllUnsent();
    const sent = sendAttempts.filter((a) => a.ok).length;

    return NextResponse.json({
      ok: true,
      queued,
      skipped,
      sent,
      unsentAttempted: sendAttempts.length,
      dueEmailCount: due.filter((d) => d.channel === "EMAIL").length,
      dueTextCount: due.filter((d) => d.channel === "TEXT").length,
      windowMinutes,
      simulatedNow: now.toISOString(),
      attempts: sendAttempts,
    });
  } catch (err: any) {
    console.error("[SEND-REMINDERS] FATAL:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}