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

function roundToMinute(d: Date): Date {
  d.setSeconds(0, 0);
  return d;
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
  return tpl.replace(/\r\n/g, "\n").replace(/\n\n+/g, "<br><br>").replace(/\n/g, "<br>");
}

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

  const nowRounded = roundToMinute(new Date(now));
  const results: DueItem[] = [];

  for (const [locationId, list] of byLocation.entries()) {
    const loc = list[0].location!;
    const minHours = Math.min(...list.map((n) => n.hoursBefore));
    const maxHours = Math.max(...list.map((n) => n.hoursBefore));

    const earliestTarget = new Date(nowRounded);
    earliestTarget.setHours(earliestTarget.getHours() + minHours);
    const latestTarget = new Date(nowRounded);
    latestTarget.setHours(latestTarget.getHours() + maxHours);

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

      const target = new Date(nowRounded);
      target.setHours(target.getHours() + n.hoursBefore);
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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get("secret");
    const dryRun = searchParams.get("dryRun") === "true";
    const nowParam = searchParams.get("now");
    const windowParam = searchParams.get("window");
    const onlyBookingId = searchParams.get("bookingId");
    const onlyChannel = (searchParams.get("channel") as "EMAIL" | "TEXT" | null) ?? null;

    if (!process.env.CRON_SECRET) {
      return NextResponse.json(
        { ok: false, error: "Missing CRON_SECRET in env" },
        { status: 500 }
      );
    }
    if (secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const now = nowParam ? new Date(nowParam) : new Date();
    const windowMinutes = windowParam ? Math.max(1, Number(windowParam)) : 5;
    const due = await findDueNotifications(now, windowMinutes, onlyBookingId, onlyChannel);

    const attempts: Array<{
      bookingId: string;
      notificationId: string;
      channel: string;
      ok: boolean;
      skipped?: string;
      error?: string;
      simulatedNow?: string;
    }> = [];
    let sent = 0;

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
        attempts.push({
          bookingId: item.bookingId,
          notificationId: item.notificationId,
          channel: item.channel,
          ok: true,
          skipped: "already-logged",
          simulatedNow: new Date(now).toISOString(),
        });
        continue;
      }

      if (dryRun) {
        attempts.push({
          bookingId: item.bookingId,
          notificationId: item.notificationId,
          channel: item.channel,
          ok: true,
          skipped: "dry-run",
          simulatedNow: new Date(now).toISOString(),
        });
        continue;
      }

      // Build context for centralized template vars
      const ctx: BookingContext = {
        bookingId: item.bookingId,
        managementToken: item.managementToken,
        startISO: item.startISO,
        endISO: item.endISO,
        firstName: item.guestFirst ?? null,
        lastName: item.guestLast ?? null,
        email: item.guestEmail ?? null,
        phone: item.guestPhone ?? null,
        bayNumber: item.bayNumber,
        locationName: item.locationName,
        locationSlug: item.locationSlug,
        manageUrl: manageUrlFor(item.bookingId, item.managementToken),
      };

      const vars = buildTemplateVars(ctx);

      if (item.channel === "EMAIL") {
        if (!item.guestEmail) {
          attempts.push({
            bookingId: item.bookingId,
            notificationId: item.notificationId,
            channel: item.channel,
            ok: false,
            error: "Missing guestEmail",
            simulatedNow: new Date(now).toISOString(),
          });
          continue;
        }

        try {
          const body = renderTemplate(item.template || "", vars);
          const html = htmlifyPreservingTags(body);
          const subject = `Reminder: ${vars.locationName} — Bay ${vars.bayNumber} at ${vars.startTime}`;
          const res = await sendEmail(item.guestEmail, subject, html);

          if (res.ok) {
            await getPrisma().notificationLog.create({
              data: {
                bookingId: item.bookingId,
                notificationId: item.notificationId,
                channel: "EMAIL",
                status: "SENT",
                providerId: res.id ?? null,
                error: null,
              },
            });
            attempts.push({
              bookingId: item.bookingId,
              notificationId: item.notificationId,
              channel: item.channel,
              ok: true,
              simulatedNow: new Date(now).toISOString(),
            });
            sent += 1;
          } else {
            await getPrisma().notificationLog.create({
              data: {
                bookingId: item.bookingId,
                notificationId: item.notificationId,
                channel: "EMAIL",
                status: "FAILED",
                providerId: null,
                error: res.error || "email send failed",
              },
            });
            attempts.push({
              bookingId: item.bookingId,
              notificationId: item.notificationId,
              channel: item.channel,
              ok: false,
              error: res.error || "email send failed",
              simulatedNow: new Date(now).toISOString(),
            });
          }
        } catch (err: any) {
          await getPrisma().notificationLog.create({
            data: {
              bookingId: item.bookingId,
              notificationId: item.notificationId,
              channel: "EMAIL",
              status: "FAILED",
              providerId: null,
              error: err?.message || "email threw",
            },
          });
          attempts.push({
            bookingId: item.bookingId,
            notificationId: item.notificationId,
            channel: item.channel,
            ok: false,
            error: err?.message || "email threw",
            simulatedNow: new Date(now).toISOString(),
          });
        }
      } else {
        // TEXT
        const normalized = normalizePhoneE164(item.guestPhone);
        if (!normalized) {
          attempts.push({
            bookingId: item.bookingId,
            notificationId: item.notificationId,
            channel: item.channel,
            ok: false,
            error: "Invalid recipient number",
            simulatedNow: new Date(now).toISOString(),
          });
          continue;
        }

        try {
          const text = renderTemplate(item.template || "", vars);
          await sendSms({
            from: process.env.OPENPHONE_FROM || "system",
            to: [normalized],
            content: text,
          });

          await getPrisma().notificationLog.create({
            data: {
              bookingId: item.bookingId,
              notificationId: item.notificationId,
              channel: "TEXT",
              status: "SENT",
              providerId: null,
              error: null,
            },
          });
          attempts.push({
            bookingId: item.bookingId,
            notificationId: item.notificationId,
            channel: item.channel,
            ok: true,
            simulatedNow: new Date(now).toISOString(),
          });
          sent += 1;
        } catch (err: any) {
          await getPrisma().notificationLog.create({
            data: {
              bookingId: item.bookingId,
              notificationId: item.notificationId,
              channel: "TEXT",
              status: "FAILED",
              providerId: null,
              error: err?.message || "sms threw",
            },
          });
          attempts.push({
            bookingId: item.bookingId,
            notificationId: item.notificationId,
            channel: item.channel,
            ok: false,
            error: err?.message || "sms threw",
            simulatedNow: new Date(now).toISOString(),
          });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      sent,
      dueEmailCount: due.filter((d) => d.channel === "EMAIL").length,
      dueTextCount: due.filter((d) => d.channel === "TEXT").length,
      windowMinutes,
      simulatedNow: new Date(now).toISOString(),
      attempts,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}