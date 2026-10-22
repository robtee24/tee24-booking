import { NextResponse } from 'next/server';
import { getPrisma } from '@/lib/db';
import { getBayAdmin, bayAdminCanAccess } from '@/lib/bay-app/admin-token';

export const runtime = 'nodejs';

/**
 * POST /api/bay-app/register  (Authorization: Bearer <bay admin token>)
 * Assign this kiosk (deviceId) to exactly one bay at one location.
 *
 * - A device can only ever be registered to one bay (deviceId is unique).
 * - A bay can only have one device. If another device holds the bay, the
 *   admin must pass `force: true` to take it over (e.g. a replaced PC).
 */
export async function POST(req: Request) {
  try {
    const admin = await getBayAdmin(req);
    if (!admin) return NextResponse.json({ error: 'Admin sign-in required' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const locationId = String(body?.locationId ?? '').trim();
    const bayNumber = Number(body?.bayNumber);
    const deviceId = String(body?.deviceId ?? '').trim();
    const force = body?.force === true;
    const hostname = body?.hostname ? String(body.hostname).trim().slice(0, 120) : null;
    const appVersion = body?.appVersion ? String(body.appVersion).trim().slice(0, 40) : null;

    if (!locationId || !deviceId || !Number.isInteger(bayNumber)) {
      return NextResponse.json({ error: 'locationId, bayNumber, and deviceId are required' }, { status: 400 });
    }
    if (!bayAdminCanAccess(admin, locationId)) {
      return NextResponse.json({ error: 'No access to this location' }, { status: 403 });
    }

    const prisma = getPrisma();
    const location = await prisma.location.findUnique({ where: { id: locationId }, select: { id: true, name: true, slug: true } });
    if (!location) return NextResponse.json({ error: 'Location not found' }, { status: 404 });

    const bay = await prisma.bay.findUnique({
      where: { locationId_number: { locationId, number: bayNumber } },
      select: { id: true, number: true, name: true, launchMonitor: true, setupNotes: true },
    });
    if (!bay) return NextResponse.json({ error: 'Bay not found' }, { status: 404 });

    const existing = await prisma.bayAppRegistration.findUnique({ where: { locationId_bayNumber: { locationId, bayNumber } } });
    if (existing && existing.deviceId !== deviceId) {
      if (!force) {
        return NextResponse.json(
          { error: 'Another computer is already assigned to this bay', code: 'BAY_TAKEN', hostname: existing.hostname },
          { status: 409 }
        );
      }
      await prisma.bayAppRegistration.delete({ where: { id: existing.id } });
    }

    const now = new Date();
    const registration = await prisma.bayAppRegistration.upsert({
      where: { deviceId },
      create: { locationId, bayNumber, deviceId, hostname, appVersion, lastSeenAt: now },
      update: { locationId, bayNumber, hostname, appVersion, lastSeenAt: now },
    });

    console.log(`[bay-app/register] ${admin.phone} assigned device ${deviceId} -> ${location.slug} bay ${bayNumber}`);
    return NextResponse.json({ ok: true, registration, location, bay });
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === 'P2002') {
      return NextResponse.json({ error: 'This bay already has a registered device', code: 'BAY_TAKEN' }, { status: 409 });
    }
    console.error('[bay-app/register]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 });
  }
}
