import { NextResponse } from 'next/server';
import { getPrisma } from '@/lib/db';
import { toE164 } from '@/lib/phone';
import { emitMemberEvent } from '@/lib/events';

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

    const checkedInAt = new Date();
    await getPrisma().booking.update({
      where: { id: bookingId },
      data: { checkedInAt },
    });

    // Also record an attendance Visit (idempotent per booking). Never affects the response.
    try {
      await recordBayAppVisit({ bookingId, locationId: booking.locationId, bayNumber: booking.bayNumber, phone: normalizedBooking, enteredAt: checkedInAt });
    } catch (e) {
      console.warn('[bay-app/check-in] visit record failed', e);
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[bay-app/check-in]', e);
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 });
  }
}

async function recordBayAppVisit(opts: { bookingId: string; locationId: string; bayNumber: number; phone: string; enteredAt: Date }) {
  const prisma = getPrisma();
  const existing = await prisma.visit.findFirst({ where: { bookingId: opts.bookingId, source: 'BAY_APP' }, select: { id: true } });
  if (existing) return;

  const booking = await prisma.booking.findUnique({ where: { id: opts.bookingId }, select: { memberId: true, email: true } });
  let memberId = booking?.memberId ?? null;
  if (!memberId) {
    const digits = opts.phone.replace(/\D/g, '').slice(-10);
    const member = await prisma.member.findFirst({
      where: {
        locationId: opts.locationId,
        status: { not: 'MERGED' },
        OR: [
          ...(booking?.email ? [{ email: booking.email.toLowerCase() }] : []),
          ...(digits.length === 10 ? [{ phone: { contains: digits } }] : []),
        ],
      },
      select: { id: true },
    });
    memberId = member?.id ?? null;
  }
  const bay = await prisma.bay.findFirst({ where: { locationId: opts.locationId, number: opts.bayNumber }, select: { id: true } });
  const visit = await prisma.visit.create({
    data: {
      memberId,
      locationId: opts.locationId,
      bayId: bay?.id ?? null,
      bookingId: opts.bookingId,
      type: 'RESERVATION',
      source: 'BAY_APP',
      enteredAt: opts.enteredAt,
      unlockCount: 1,
    },
  });
  if (memberId) {
    void emitMemberEvent('visit.checked-in', { memberId, locationId: opts.locationId, refs: { visitId: visit.id }, vars: { visitType: 'RESERVATION', source: 'BAY_APP' } });
  }
}
