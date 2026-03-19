import { NextResponse } from 'next/server';
import { getPrisma } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * GET /api/bay-app/locations
 * List locations with bay app enabled, including bays and existing registrations.
 * Used by the desktop app during admin setup.
 */
export async function GET() {
  try {
    const locations = await getPrisma().location.findMany({
      where: { disabled: false },
      select: {
        id: true,
        name: true,
        slug: true,
        bayAppEnabled: true,
        bays: {
          where: { disabled: false },
          select: { id: true, number: true, name: true },
          orderBy: { number: 'asc' },
        },
        bayAppRegistrations: {
          select: { bayNumber: true, deviceId: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({ locations });
  } catch (e: any) {
    console.error('[bay-app/locations]', e);
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 });
  }
}
