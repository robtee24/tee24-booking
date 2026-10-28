import { NextResponse } from 'next/server';
import { getPrisma } from '@/lib/db';
import { remoteInfoForKiosk, normalizeNodeId } from '@/lib/remote/meshcentral';
import { getPlayerAllowance } from '@/services/bay-players.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/bay-app/status?deviceId=...&v=<appVersion>&nodeId=<mesh node id>
 *
 * Core polling endpoint for the bay kiosk. Returns:
 *  - location kiosk settings
 *  - bay info (number, name, launch monitor, setup notes)
 *  - currentBooking  (active now; the kiosk shows the unlock modal until checked in)
 *  - nextBooking     (starts within the warning window; the kiosk shows the "upcoming" modal)
 *  - serverNow       (so the kiosk never trusts the PC clock for countdowns)
 *
 * Also records a heartbeat (lastSeenAt / appVersion) on the registration so admins
 * can see which kiosks are online.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const deviceId = (searchParams.get('deviceId') ?? '').trim();
    const appVersion = (searchParams.get('v') ?? '').trim() || null;
    const remoteNodeId = normalizeNodeId(searchParams.get('nodeId') ?? '');

    if (!deviceId) {
      return NextResponse.json({ error: 'deviceId required' }, { status: 400 });
    }

    const prisma = getPrisma();

    const registration = await prisma.bayAppRegistration.findUnique({
      where: { deviceId },
      include: {
        location: {
          select: {
            id: true,
            name: true,
            slug: true,
            timezone: true,
            phone: true,
            bayAppEnabled: true,
            bayAppUnlockMinutes: true,
            bayAppWarningMinutes: true,
            bayAppAutoCancelOnTimeout: true,
            bayAppGuestEnforcement: true,
            passAccessUrl: true,
          },
        },
      },
    });

    if (!registration) {
      return NextResponse.json({ error: 'Device not registered' }, { status: 404 });
    }

    const { location, bayNumber, locationId } = registration;
    const now = new Date();

    // Heartbeat (fire-and-forget; never block the poll on it)
    prisma.bayAppRegistration
      .update({
        where: { deviceId },
        data: { lastSeenAt: now, ...(appVersion ? { appVersion } : {}), ...(remoteNodeId ? { remoteNodeId } : {}) },
      })
      .catch(() => {});

    const warningEnd = new Date(now.getTime() + location.bayAppWarningMinutes * 60 * 1000);

    const [currentBooking, nextBooking, bay] = await Promise.all([
      prisma.booking.findFirst({
        where: { locationId, bayNumber, canceledAt: null, start: { lte: now }, end: { gt: now } },
        select: { id: true, firstName: true, lastName: true, start: true, end: true, checkedInAt: true },
        orderBy: { start: 'asc' },
      }),
      prisma.booking.findFirst({
        where: { locationId, bayNumber, canceledAt: null, start: { gt: now, lte: warningEnd } },
        select: { id: true, firstName: true, lastName: true, start: true, end: true },
        orderBy: { start: 'asc' },
      }),
      prisma.bay.findUnique({
        where: { locationId_number: { locationId, number: bayNumber } },
        select: { id: true, number: true, name: true, launchMonitor: true, setupNotes: true, disabled: true },
      }),
    ]);

    // Player allowance (member + guests) so the kiosk can compare against the
    // players GSPro shows. Never let a failure here break the poll. When the
    // location has guest enforcement off we send no allowance at all — the kiosk
    // treats a missing allowance as "not enforced" and never shows the players modal.
    let players: Awaited<ReturnType<typeof getPlayerAllowance>> | null = null;
    if (currentBooking && location.bayAppGuestEnforcement) {
      try {
        players = await getPlayerAllowance(currentBooking.id);
      } catch (e) {
        console.warn('[bay-app/status] player allowance failed', e);
      }
    }

    return NextResponse.json({
      serverNow: now.toISOString(),
      remote: remoteInfoForKiosk(),
      remoteNodeId: remoteNodeId ?? registration.remoteNodeId ?? null,
      location: {
        id: location.id,
        name: location.name,
        slug: location.slug,
        timezone: location.timezone,
        phone: location.phone,
        bayAppEnabled: location.bayAppEnabled,
        bayAppUnlockMinutes: location.bayAppUnlockMinutes,
        bayAppWarningMinutes: location.bayAppWarningMinutes,
        bayAppAutoCancelOnTimeout: location.bayAppAutoCancelOnTimeout,
        bayAppGuestEnforcement: location.bayAppGuestEnforcement,
        passAccessUrl: location.passAccessUrl,
      },
      bay: bay
        ? {
            id: bay.id,
            number: bay.number,
            name: bay.name,
            launchMonitor: bay.launchMonitor,
            setupNotes: bay.setupNotes,
            disabled: bay.disabled,
          }
        : { id: null, number: bayNumber, name: null, launchMonitor: 'IDRA', setupNotes: null, disabled: false },
      // Never send the guest's phone number to the bay PC — only the last 4 for a hint.
      currentBooking: currentBooking
        ? {
            id: currentBooking.id,
            firstName: currentBooking.firstName,
            lastInitial: (currentBooking.lastName ?? '').trim().charAt(0).toUpperCase(),
            start: currentBooking.start.toISOString(),
            end: currentBooking.end.toISOString(),
            checkedInAt: currentBooking.checkedInAt ? currentBooking.checkedInAt.toISOString() : null,
            players: players
              ? {
                  allowedPlayers: players.allowedPlayers,
                  includedGuests: players.booker.includedGuests,
                  bookedGuests: players.booker.bookedGuests,
                  companions: players.companions.map((c) => ({ firstName: c.firstName, lastInitial: c.lastInitial, includedGuests: c.includedGuests })),
                  unauthorizedGuestFeeCents: players.unauthorizedGuestFeeCents,
                }
              : null,
          }
        : null,
      nextBooking: nextBooking
        ? {
            id: nextBooking.id,
            firstName: nextBooking.firstName,
            lastInitial: (nextBooking.lastName ?? '').trim().charAt(0).toUpperCase(),
            start: nextBooking.start.toISOString(),
            end: nextBooking.end.toISOString(),
          }
        : null,
    });
  } catch (e: unknown) {
    console.error('[bay-app/status]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 });
  }
}
