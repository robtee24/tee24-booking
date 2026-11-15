import { NextResponse } from 'next/server';
import { BayWalkInError, createWalkIn, getWalkInPlan } from '@/services/bay-walkin.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Walk-in reservations from the bay kiosk's Play button.
 *
 *   GET  /api/bay-app/walk-in?deviceId=
 *        What Play should do right now: { mode: 'launch' | 'confirm' | 'walkin', ... }
 *        (see services/bay-walkin.service.ts).
 *   POST /api/bay-app/walk-in { deviceId, minutes, phone }
 *        Reserve this bay from now for `minutes`, under that phone number.
 *        Returns { booking }.
 *
 * Inert unless the location has "Walk-in reservations at the bay" turned on:
 * GET then always answers { mode: 'launch' } and POST is refused.
 */
function fail(e: unknown) {
  if (e instanceof BayWalkInError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  console.error('[bay-app/walk-in]', e);
  return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    const deviceId = (new URL(req.url).searchParams.get('deviceId') ?? '').trim();
    if (!deviceId) return NextResponse.json({ error: 'deviceId required' }, { status: 400 });
    return NextResponse.json(await getWalkInPlan(deviceId));
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const deviceId = String(body.deviceId ?? '').trim();
    if (!deviceId) return NextResponse.json({ error: 'deviceId required' }, { status: 400 });
    return NextResponse.json(await createWalkIn({ deviceId, minutes: Number(body.minutes), phone: String(body.phone ?? '') }));
  } catch (e) {
    return fail(e);
  }
}
