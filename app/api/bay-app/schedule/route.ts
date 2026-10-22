import { NextResponse } from 'next/server';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { getPrisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/bay-app/schedule?deviceId=...&date=YYYY-MM-DD
 *
 * Reservation schedule for the bay this kiosk is registered to, for one local day
 * (defaults to "today" in the location's timezone). Guest identity is reduced to
 * first name + last initial — the bay PC must never see full contact details.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const deviceId = (searchParams.get('deviceId') ?? '').trim();
    const dateParam = (searchParams.get('date') ?? '').trim();

    if (!deviceId) {
      return NextResponse.json({ error: 'deviceId required' }, { status: 400 });
    }

    const prisma = getPrisma();
    const registration = await prisma.bayAppRegistration.findUnique({
      where: { deviceId },
      include: { location: { select: { id: true, name: true, timezone: true, hours: true, open24Hours: true } } },
    });
    if (!registration) {
      return NextResponse.json({ error: 'Device not registered' }, { status: 404 });
    }

    const { location, bayNumber, locationId } = registration;
    const tz = location.timezone || 'America/New_York';

    // Resolve the requested local day
    const nowLocal = toZonedTime(new Date(), tz);
    const todayISO = `${nowLocal.getFullYear()}-${String(nowLocal.getMonth() + 1).padStart(2, '0')}-${String(nowLocal.getDate()).padStart(2, '0')}`;
    const dateISO = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayISO;

    const dayStartUTC = fromZonedTime(new Date(`${dateISO}T00:00:00`), tz);
    const dayEndUTC = fromZonedTime(new Date(`${dateISO}T23:59:59.999`), tz);

    const bookings = await prisma.booking.findMany({
      where: {
        locationId,
        bayNumber,
        canceledAt: null,
        start: { lt: dayEndUTC },
        end: { gt: dayStartUTC },
      },
      orderBy: { start: 'asc' },
      select: { id: true, firstName: true, lastName: true, start: true, end: true, checkedInAt: true },
    });

    return NextResponse.json({
      serverNow: new Date().toISOString(),
      dateISO,
      timezone: tz,
      location: { name: location.name, open24Hours: location.open24Hours, hours: location.hours },
      bay: { number: bayNumber },
      bookings: bookings.map((b) => ({
        id: b.id,
        firstName: b.firstName,
        lastInitial: (b.lastName ?? '').trim().charAt(0).toUpperCase(),
        start: b.start.toISOString(),
        end: b.end.toISOString(),
        checkedIn: !!b.checkedInAt,
      })),
    });
  } catch (e: any) {
    console.error('[bay-app/schedule]', e);
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 });
  }
}
