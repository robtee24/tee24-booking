import { NextResponse } from 'next/server';
import { getPrisma } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * POST /api/bay-app/register
 * Register a desktop app instance to a specific bay.
 * Uses upsert so re-registering the same device updates the record,
 * and the unique constraint on [locationId, bayNumber] prevents two devices on one bay.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const locationId = String(body?.locationId ?? '').trim();
    const bayNumber = Number(body?.bayNumber);
    const deviceId = String(body?.deviceId ?? '').trim();

    if (!locationId || !deviceId || !Number.isFinite(bayNumber)) {
      return NextResponse.json(
        { error: 'locationId, bayNumber, and deviceId are required' },
        { status: 400 }
      );
    }

    const location = await getPrisma().location.findUnique({
      where: { id: locationId },
      select: { id: true, name: true },
    });
    if (!location) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 });
    }

    const bay = await getPrisma().bay.findUnique({
      where: { locationId_number: { locationId, number: bayNumber } },
      select: { id: true, number: true },
    });
    if (!bay) {
      return NextResponse.json({ error: 'Bay not found' }, { status: 404 });
    }

    const existing = await getPrisma().bayAppRegistration.findUnique({
      where: { locationId_bayNumber: { locationId, bayNumber } },
    });
    if (existing && existing.deviceId !== deviceId) {
      return NextResponse.json(
        { error: 'Another device is already registered to this bay' },
        { status: 409 }
      );
    }

    const registration = await getPrisma().bayAppRegistration.upsert({
      where: { deviceId },
      create: { locationId, bayNumber, deviceId },
      update: { locationId, bayNumber },
    });

    return NextResponse.json({ ok: true, registration });
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return NextResponse.json(
        { error: 'This bay already has a registered device' },
        { status: 409 }
      );
    }
    console.error('[bay-app/register]', e);
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 });
  }
}
