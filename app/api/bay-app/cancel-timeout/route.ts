import { NextResponse } from 'next/server';
import { getPrisma } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * POST /api/bay-app/cancel-timeout
 * Called when the unlock timer expires. Cancels the booking.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const deviceId = String(body?.deviceId ?? '').trim();
    const bookingId = String(body?.bookingId ?? '').trim();

    if (!deviceId || !bookingId) {
      return NextResponse.json(
        { error: 'deviceId and bookingId are required' },
        { status: 400 }
      );
    }

    const registration = await getPrisma().bayAppRegistration.findUnique({
      where: { deviceId },
      include: {
        location: {
          select: { bayAppAutoCancelOnTimeout: true },
        },
      },
    });
    if (!registration) {
      return NextResponse.json({ error: 'Device not registered' }, { status: 404 });
    }

    if (!registration.location.bayAppAutoCancelOnTimeout) {
      return NextResponse.json({ ok: true, cancelled: false, reason: 'auto-cancel disabled' });
    }

    const booking = await getPrisma().booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        locationId: true,
        bayNumber: true,
        canceledAt: true,
        checkedInAt: true,
      },
    });

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    if (booking.locationId !== registration.locationId || booking.bayNumber !== registration.bayNumber) {
      return NextResponse.json({ error: 'Booking does not match this bay' }, { status: 403 });
    }

    if (booking.checkedInAt) {
      return NextResponse.json({ ok: true, cancelled: false, reason: 'already checked in' });
    }

    if (booking.canceledAt) {
      return NextResponse.json({ ok: true, cancelled: false, reason: 'already cancelled' });
    }

    await getPrisma().booking.update({
      where: { id: bookingId },
      data: { canceledAt: new Date() },
    });

    return NextResponse.json({ ok: true, cancelled: true });
  } catch (e: any) {
    console.error('[bay-app/cancel-timeout]', e);
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 });
  }
}
