import { NextResponse } from 'next/server';
import { getPrisma } from '@/lib/db';
import { getBayAdmin, bayAdminCanAccess } from '@/lib/bay-app/admin-token';
import { updateBay } from '@/services/bay.service';
import type { LaunchMonitor } from '@/types/bay';

export const runtime = 'nodejs';

const LAUNCH_MONITORS: LaunchMonitor[] = ['IDRA', 'SKYTRAK', 'PROTEE_VX', 'OTHER'];

/**
 * Bay settings editable from the kiosk's admin Settings screen.
 *
 * GET   /api/bay-app/bay-settings?deviceId=...   -> current bay + location kiosk settings
 * PATCH /api/bay-app/bay-settings                 { deviceId, name?, launchMonitor?, setupNotes? }
 *
 * Both require a bay admin bearer token (Quo SMS sign-in) with access to the location.
 */
export async function GET(req: Request) {
  const admin = await getBayAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Admin sign-in required' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const deviceId = (searchParams.get('deviceId') ?? '').trim();
  if (!deviceId) return NextResponse.json({ error: 'deviceId required' }, { status: 400 });

  const ctx = await loadContext(deviceId);
  if (!ctx) return NextResponse.json({ error: 'Device not registered' }, { status: 404 });
  if (!bayAdminCanAccess(admin, ctx.location.id)) return NextResponse.json({ error: 'No access' }, { status: 403 });

  return NextResponse.json({ ok: true, ...ctx });
}

export async function PATCH(req: Request) {
  try {
    const admin = await getBayAdmin(req);
    if (!admin) return NextResponse.json({ error: 'Admin sign-in required' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const deviceId = String(body?.deviceId ?? '').trim();
    if (!deviceId) return NextResponse.json({ error: 'deviceId required' }, { status: 400 });

    const ctx = await loadContext(deviceId);
    if (!ctx) return NextResponse.json({ error: 'Device not registered' }, { status: 404 });
    if (!bayAdminCanAccess(admin, ctx.location.id)) return NextResponse.json({ error: 'No access' }, { status: 403 });

    const patch: { name?: string | null; launchMonitor?: LaunchMonitor; setupNotes?: string | null } = {};
    if ('name' in body) patch.name = body.name ? String(body.name).trim().slice(0, 80) : null;
    if ('launchMonitor' in body) {
      const lm = String(body.launchMonitor).toUpperCase() as LaunchMonitor;
      if (!LAUNCH_MONITORS.includes(lm)) return NextResponse.json({ error: 'Invalid launch monitor' }, { status: 400 });
      patch.launchMonitor = lm;
    }
    if ('setupNotes' in body) patch.setupNotes = body.setupNotes ? String(body.setupNotes).trim().slice(0, 4000) : null;

    const bay = await updateBay(ctx.location.id, { bayId: ctx.bay.id, ...patch });
    console.log(`[bay-app/bay-settings] ${admin.phone} updated bay ${ctx.bay.number} @ ${ctx.location.slug}`);
    return NextResponse.json({ ok: true, bay });
  } catch (e: unknown) {
    console.error('[bay-app/bay-settings]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 });
  }
}

async function loadContext(deviceId: string) {
  const reg = await getPrisma().bayAppRegistration.findUnique({
    where: { deviceId },
    include: {
      location: {
        select: {
          id: true, name: true, slug: true, timezone: true,
          bayAppEnabled: true, bayAppUnlockMinutes: true, bayAppWarningMinutes: true, bayAppAutoCancelOnTimeout: true,
        },
      },
    },
  });
  if (!reg) return null;
  const bay = await getPrisma().bay.findUnique({
    where: { locationId_number: { locationId: reg.locationId, number: reg.bayNumber } },
    select: { id: true, number: true, name: true, launchMonitor: true, setupNotes: true, disabled: true },
  });
  if (!bay) return null;
  return {
    location: reg.location,
    bay,
    registration: { deviceId: reg.deviceId, hostname: reg.hostname, appVersion: reg.appVersion, remoteNodeId: reg.remoteNodeId, lastSeenAt: reg.lastSeenAt },
  };
}
