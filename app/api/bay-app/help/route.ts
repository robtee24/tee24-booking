import { NextResponse } from 'next/server';
import { getPrisma } from '@/lib/db';
import {
  COMMON_NODE_ID,
  TROUBLESHOOTING_TREE,
  entryNodeFor,
} from '@/lib/kiosk/troubleshooting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/bay-app/help?deviceId=...
 *
 * Returns the troubleshooting decision tree plus the entry node for this bay's
 * launch monitor, so the kiosk "Help" button opens directly on the right menu.
 * Also returns the bay's setup notes for the "Setup Help" screen.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const deviceId = (searchParams.get('deviceId') ?? '').trim();

    // Unregistered kiosks (first boot) still get the generic tree so Setup Help works.
    if (!deviceId) {
      return NextResponse.json({
        tree: TROUBLESHOOTING_TREE,
        entryNodeId: 'start',
        commonNodeId: COMMON_NODE_ID,
        bay: null,
        location: null,
      });
    }

    const registration = await getPrisma().bayAppRegistration.findUnique({
      where: { deviceId },
      include: { location: { select: { id: true, name: true, slug: true, passAccessUrl: true } } },
    });
    if (!registration) {
      return NextResponse.json({ error: 'Device not registered' }, { status: 404 });
    }

    const bay = await getPrisma().bay.findUnique({
      where: { locationId_number: { locationId: registration.locationId, number: registration.bayNumber } },
      select: { id: true, number: true, name: true, launchMonitor: true, setupNotes: true },
    });

    return NextResponse.json({
      tree: TROUBLESHOOTING_TREE,
      entryNodeId: entryNodeFor(bay?.launchMonitor),
      commonNodeId: COMMON_NODE_ID,
      bay: bay
        ? { number: bay.number, name: bay.name, launchMonitor: bay.launchMonitor, setupNotes: bay.setupNotes }
        : { number: registration.bayNumber, name: null, launchMonitor: 'OTHER', setupNotes: null },
      location: {
        name: registration.location.name,
        slug: registration.location.slug,
        passAccessUrl: registration.location.passAccessUrl,
      },
    });
  } catch (e: any) {
    console.error('[bay-app/help]', e);
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 });
  }
}
