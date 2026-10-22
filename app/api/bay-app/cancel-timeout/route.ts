import { NextResponse } from 'next/server';
import { getPrisma } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * POST /api/bay-app/cancel-timeout
 *
 * Called by the kiosk when the unlock window closes without a check-in.
 * This is the ONLY bay-app endpoint that can alter a reservation, so it is
 * deliberately conservative. The booking is cancelled only when ALL hold:
 *   - the device is registered to the booking's location + bay
 *   - the location has the kiosk enabled
 *   - the location has explicitly opted in to auto-cancel (off by default)
 *   - the unlock window has actually elapsed by the SERVER clock
 *   - the booking is not checked in, not already cancelled, and not over
 * Every other case returns { ok: true, cancelled: false, reason } so the kiosk
 * simply dismisses its prompt.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const deviceId = String(body?.deviceId ?? '').trim();
    const bookingId = String(body?.bookingId ?? '').trim();

    if (!deviceId || !bookingId) {
      return NextResponse.json({ error: 'deviceId and bookingId are required' }, { status: 400 });
    }

    const prisma = getPrisma();
    const registration = await prisma.bayAppRegistration.findUnique({
      where: { deviceId },
      include: {
        location: {
          select: { bayAppEnabled: true, bayAppAutoCancelOnTimeout: true, bayAppUnlockMinutes: true },
        },
      },
    });
    if (!registration) {
      return NextResponse.json({ error: 'Device not registered' }, { status: 404 });
    }

    if (!registration.location.bayAppEnabled) {
      return NextResponse.json({ ok: true, cancelled: false, reason: 'kiosk disabled for location' });
    }
    if (!registration.location.bayAppAutoCancelOnTimeout) {
      return NextResponse.json({ ok: true, cancelled: false, reason: 'auto-cancel disabled' });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, locationId: true, bayNumber: true, start: true, end: true, canceledAt: true, checkedInAt: true },
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

    // Server-side time check: never trust the kiosk's clock.
    const now = Date.now();
    const unlockMs = Math.max(1, registration.location.bayAppUnlockMinutes || 10) * 60_000;
    const deadline = new Date(booking.start).getTime() + unlockMs;
    if (now < deadline) {
      return NextResponse.json({ ok: true, cancelled: false, reason: 'unlock window still open' });
    }
    if (now >= new Date(booking.end).getTime()) {
      return NextResponse.json({ ok: true, cancelled: false, reason: 'booking already ended' });
    }

    // Re-check atomically so a check-in racing with the timeout wins.
    const result = await prisma.booking.updateMany({
      where: { id: bookingId, canceledAt: null, checkedInAt: null },
      data: { canceledAt: new Date() },
    });
    if (result.count === 0) {
      return NextResponse.json({ ok: true, cancelled: false, reason: 'state changed' });
    }

    console.log(`[bay-app/cancel-timeout] cancelled booking ${bookingId} (device ${deviceId})`);
    return NextResponse.json({ ok: true, cancelled: true });
  } catch (e: unknown) {
    console.error('[bay-app/cancel-timeout]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 });
  }
}
