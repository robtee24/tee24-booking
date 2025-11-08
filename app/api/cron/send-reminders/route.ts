// app/api/cron/send-reminders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { NotificationChannel } from "@prisma/client";
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
  channel: NotificationChannel;
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
  onlyChannel?: NotificationChannel | null,
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
          channel: item.channel as unknown as string,
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
          channel: item.channel as unknown as string,
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
        channel: item.channel as unknown as string,
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
  const unsentLogs = await getPrisma().notificationLog.findMany({
    where: { status: "UNSENT" },
    select: {
      id: true,
      bookingId: true,
      notificationId: true,
      channel: true,
    },
    orderBy: { sentAt: "asc" },
  });

  DEBUG(`Found ${unsentLogs.length} UNSENT logs to send`);
  const attempts: Array<any> = [];

  const bookingIds = unsentLogs.map(l => l.bookingId);
  const notificationIds = unsentLogs.map(l => l.notificationId);

  const [bookings, notifications] = await Promise.all([
    getPrisma().booking.findMany({
      where: { id: { in: bookingIds } },
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
        Location: {
          select: { slug: true, name: true },
        },
      },
    }),
    getPrisma().notification.findMany({
      where: { id: { in: notificationIds } },
      select: {
        id: true,
        template: true,
        channel: true,
      },
    }),
  ]);

  const bookingMap = Object.fromEntries(bookings.map(b => [b.id, b]));
  const notificationMap = Object.fromEntries(notifications.map(n => [n.id, n]));

  for (const log of unsentLogs) {
    const b = bookingMap[log.bookingId];
    const n = notificationMap[log.notificationId];

    if (!b || !n) {
      await getPrisma().notificationLog.update({
        where: { id: log.id },
        data: { status: "FAILED", error: "Missing booking or notification" },
      });
      attempts.push({
        bookingId: log.bookingId,
        notificationId: log.notificationId,
        channel: log.channel,
        ok: false,
        error: "Missing related data",
        simulatedNow: now.toISOString(),
      });
      continue;
    }

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
      locationName: b.Location.name,
      locationSlug: b.Location.slug,
      manageUrl: manageUrlFor(b.id, b.managementToken ?? undefined),
    };

    const vars = buildTemplateVars(ctx);

    // === EMAIL ===
    if (n.channel === NotificationChannel.EMAIL) {
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
          bookingId