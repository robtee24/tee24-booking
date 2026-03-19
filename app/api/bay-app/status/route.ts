import { NextResponse } from 'next/server';
import { getPrisma } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * GET /api/bay-app/status?deviceId=...
 * Core polling endpoint for the desktop bay app.
 * Returns current booking (needs check-in), next upcoming booking (for warning bar),
 * and location settings.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const deviceId = (searchParams.get('deviceId') ?? '').trim();

    if (!deviceId) {
      return NextResponse.json({ error: 'deviceId required' }, { status: 400 });
    }

    const registration = await getPrisma().bayAppRegistration.findUnique({
      where: { deviceId },
      include: {
        location: {
          select: {
            id: true,
            name: true,
            timezone: true,
            bayAppEnabled: true,
            bayAppUnlockMinutes: true,
            bayAppWarningMinutes: true,
            bayAppAutoCancelOnTimeout: true,
          },
        },
      },
    });

    if (!registration) {
      return NextResponse.json({ error: 'Device not registered' }, { status: 404 });
    }

    const { location, bayNumber, locationId } = registration;
    const now = new Date();

    const currentBooking = await getPrisma().booking.findFirst({
      where: {
        locationId,
        bayNumber,
        canceledAt: null,
        start: { lte: now },
        end: { gt: now },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        start: true,
        end: true,
        checkedInAt: true,
      },
      orderBy: { start: 'asc' },
    });

    const warningWindowMs = location.bayAppWarningMinutes * 60 * 1000;
    const warningStart = new Date(now.getTime());
    const warningEnd = new Date(now.getTime() + warningWindowMs);

    const nextBooking = await getPrisma().booking.findFirst({
      where: {
        locationId,
        bayNumber,
        canceledAt: null,
        start: { gt: now, lte: warningEnd },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        start: true,
        end: true,
      },
      orderBy: { start: 'asc' },
    });

    const bay = await getPrisma().bay.findUnique({
      where: { locationId_number: { locationId, number: bayNumber } },
      select: { number: true, name: true },
    });

    return NextResponse.json({
      location: {
        name: location.name,
        timezone: location.timezone,
        bayAppEnabled: location.bayAppEnabled,
        bayAppUnlockMinutes: location.bayAppUnlockMinutes,
        bayAppWarningMinutes: location.bayAppWarningMinutes,
        bayAppAutoCancelOnTimeout: location.bayAppAutoCancelOnTimeout,
      },
      bay: bay ?? { number: bayNumber, name: null },
      currentBooking,
      nextBooking,
    });
  } catch (e: any) {
    console.error('[bay-app/status]', e);
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 });
  }
}
