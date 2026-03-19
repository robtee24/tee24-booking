import { NextResponse } from 'next/server';
import { getPrisma } from '@/lib/db';
import { toE164 } from '@/lib/phone';

export const runtime = 'nodejs';

/**
 * POST /api/bay-app/check-in
 * Verify guest phone number against booking and mark as checked in.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const deviceId = String(body?.deviceId ?? '').trim();
    const bookingId = String(body?.bookingId ?? '').trim();
    const rawPhone = String(body?.phone ?? '').trim();

    if (!deviceId || !bookingId || !rawPhone) {
      return NextResponse.json(
        { error: 'deviceId, bookingId, and phone are required' },
        { status: 400 }
      );
    }

    const registration = await getPrisma().bayAppRegistration.findUnique({
      where: { deviceId },
    });
    if (!registration) {
      return NextResponse.json({ error: 'Device not registered' }, { status: 404 });
    }

    const booking = await getPrisma().booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        phone: true,
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

    if (booking.canceledAt) {
      return NextResponse.json({ error: 'Booking has been cancelled' }, { status: 410 });
    }

    if (booking.checkedInAt) {
      return NextResponse.json({ ok: true, alreadyCheckedIn: true });
    }

    let normalizedInput: string;
    try {
      normalizedInput = toE164(rawPhone);
    } catch {
      return NextResponse.json({ error: 'Invalid phone number format' }, { status: 400 });
    }

    let normalizedBooking: string;
    try {
      normalizedBooking = toE164(booking.phone);
    } catch {
      normalizedBooking = booking.phone;
    }

    if (normalizedInput !== normalizedBooking) {
      return NextResponse.json({ error: 'Phone number does not match reservation' }, { status: 403 });
    }

    await getPrisma().booking.update({
      where: { id: bookingId },
      data: { checkedInAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[bay-app/check-in]', e);
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 });
  }
}
