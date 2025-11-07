// app/api/debug/add-email-1h/route.ts
import { NextResponse } from 'next/server';
import { getPrisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Upserts a 1-hour EMAIL "NOTIFICATION" for the given location (default: clarksville).
 * This lets us test EMAIL sends against bookings ~60 minutes out.
 *
 * Example:
 *   GET /api/debug/add-email-1h           -> uses clarksville
 *   GET /api/debug/add-email-1h?slug=abc  -> uses location "abc"
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? 'clarksville';

  try {
    const location = await getPrisma().location.findUnique({
      where: { slug },
      select: { id: true, name: true, slug: true },
    });
    if (!location) {
      return NextResponse.json({ ok: false, error: 'Location not found' }, { status: 404 });
    }

    // Create or update a 1-hour EMAIL NOTIFICATION
    // (hoursBefore > 0 is "scheduled" per your schema/logic)
    const existing = await getPrisma().notification.findFirst({
      where: {
        locationId: location.id,
        kind: 'NOTIFICATION',
        channel: 'EMAIL',
        hoursBefore: 1,
      },
      select: { id: true },
    });

    const template =
      'Reminder: Your booking for Bay {{bayNumber}} starts at {{startTime}}. Manage: {{manageUrl}}';

    let record;
    if (existing) {
      record = await getPrisma().notification.update({
        where: { id: existing.id },
        data: {
          enabled: true,
          template,
          order: 0,
        },
        select: {
          id: true,
          kind: true,
          channel: true,
          hoursBefore: true,
          enabled: true,
          order: true,
        },
      });
    } else {
      record = await getPrisma().notification.create({
        data: {
          locationId: location.id,
          kind: 'NOTIFICATION',
          channel: 'EMAIL',
          hoursBefore: 1,
          enabled: true,
          template,
          order: 0,
        },
        select: {
          id: true,
          kind: true,
          channel: true,
          hoursBefore: true,
          enabled: true,
          order: true,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      location,
      upserted: record,
      hint: 'Create a booking 60 minutes out, then run /api/cron/send-reminders to see EMAIL entries.',
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Server error' }, { status: 500 });
  }
}

