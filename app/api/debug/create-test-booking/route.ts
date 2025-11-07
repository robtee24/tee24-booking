// app/api/debug/create-test-booking/route.ts
import { NextResponse } from 'next/server';
import { getPrisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const minutes = Math.max(1, Number(url.searchParams.get('minutes') ?? 60));
    const bay = Number(url.searchParams.get('bay') ?? 1);
    const locationSlug = url.searchParams.get('locationSlug') ?? 'clarksville';

    // Optional overrides for guest
    const firstName = url.searchParams.get('firstName') ?? 'Test';
    const lastName = url.searchParams.get('lastName') ?? 'User';
    const email = url.searchParams.get('email') ?? 'test@example.com';
    const phone = url.searchParams.get('phone') ?? '+15555550123'; // <-- can override via ?phone=%2B1...

    const location = await getPrisma().location.findUnique({
      where: { slug: locationSlug },
      select: { id: true, slug: true, name: true },
    });

    if (!location) {
      return NextResponse.json({ ok: false, error: 'Location not found' }, { status: 404 });
    }

    const now = new Date();
    const start = new Date(now.getTime() + minutes * 60_000);
    start.setSeconds(0, 0);
    const end = new Date(start.getTime() + 60 * 60_000); // 60 min default

    const created = await getPrisma().booking.create({
      data: {
        locationId: location.id,
        start,
        end,
        bayNumber: bay,
        firstName,
        lastName,
        email,
        phone,
      },
      select: { id: true, start: true, end: true, bayNumber: true },
    });

    return NextResponse.json({
      ok: true,
      created,
      hint: 'Now call /api/cron/send-reminders with your secret to preview due reminders.',
    });
  } catch (e: any) {
    console.error('create-test-booking error', e);
    return NextResponse.json({ ok: false, error: e?.message ?? 'Server error' }, { status: 500 });
  }
}

