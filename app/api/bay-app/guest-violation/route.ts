import { NextResponse } from 'next/server';
import { BayPlayersError, recordGuestViolation } from '@/services/bay-players.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/bay-app/guest-violation
 *   { deviceId, bookingId?, screen: 'SETUP'|'ROUND', action: 'PROCEEDED'|'EXITED', playerCount, allowedPlayers }
 *
 * The kiosk's too-many-players modal was answered: either the player ticked
 * "I understand" and proceeded (charged per extra guest) or chose to exit the
 * game (no charge). Either way the admin inbox gets a timestamped alert.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const deviceId = String(body.deviceId ?? '').trim();
    if (!deviceId) return NextResponse.json({ error: 'deviceId required' }, { status: 400 });
    const screen = String(body.screen ?? '').toUpperCase() === 'ROUND' ? 'ROUND' : 'SETUP';
    const action = String(body.action ?? '').toUpperCase() === 'EXITED' ? 'EXITED' : 'PROCEEDED';
    const playerCount = Number(body.playerCount);
    const allowedPlayers = Number(body.allowedPlayers);
    if (!Number.isFinite(playerCount) || !Number.isFinite(allowedPlayers)) {
      return NextResponse.json({ error: 'playerCount and allowedPlayers required' }, { status: 400 });
    }
    const result = await recordGuestViolation({
      deviceId,
      bookingId: body.bookingId ? String(body.bookingId) : null,
      screen,
      action,
      playerCount,
      allowedPlayers,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof BayPlayersError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    console.error('[bay-app/guest-violation]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 });
  }
}
