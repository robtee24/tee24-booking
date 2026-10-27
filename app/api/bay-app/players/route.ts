import { NextResponse } from 'next/server';
import { getPrisma } from '@/lib/db';
import { addCompanionByPhone, BayPlayersError, getPlayerAllowance } from '@/services/bay-players.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Player allowance for the booking currently on this bay.
 *
 *   GET  /api/bay-app/players?deviceId=&bookingId=
 *   POST /api/bay-app/players { deviceId, bookingId, action: 'add-member', phone }
 *        "Other players are members": look the member up by phone and add their
 *        own allowance (1 + their included guests) to this bay.
 *
 * Both return { allowedPlayers, booker, companions, unauthorizedGuestFeeCents }.
 */
async function bookingForDevice(deviceId: string, bookingId: string) {
  const prisma = getPrisma();
  const reg = await prisma.bayAppRegistration.findUnique({ where: { deviceId }, select: { locationId: true, bayNumber: true } });
  if (!reg) throw new BayPlayersError(404, 'DEVICE_NOT_REGISTERED', 'Device not registered');
  const booking = await prisma.booking.findFirst({ where: { id: bookingId, locationId: reg.locationId, bayNumber: reg.bayNumber }, select: { id: true } });
  if (!booking) throw new BayPlayersError(403, 'BOOKING_MISMATCH', 'Booking does not match this bay');
  return booking.id;
}

function fail(e: unknown) {
  if (e instanceof BayPlayersError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  console.error('[bay-app/players]', e);
  return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const deviceId = (searchParams.get('deviceId') ?? '').trim();
    const bookingId = (searchParams.get('bookingId') ?? '').trim();
    if (!deviceId || !bookingId) return NextResponse.json({ error: 'deviceId and bookingId required' }, { status: 400 });
    const id = await bookingForDevice(deviceId, bookingId);
    return NextResponse.json(await getPlayerAllowance(id));
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const deviceId = String(body.deviceId ?? '').trim();
    const bookingId = String(body.bookingId ?? '').trim();
    const action = String(body.action ?? '');
    if (!deviceId || !bookingId) return NextResponse.json({ error: 'deviceId and bookingId required' }, { status: 400 });
    const id = await bookingForDevice(deviceId, bookingId);
    if (action === 'add-member') {
      return NextResponse.json(await addCompanionByPhone(id, String(body.phone ?? '')));
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
