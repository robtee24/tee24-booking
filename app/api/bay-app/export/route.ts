import { NextResponse } from 'next/server';
import { intakeKioskExport, KioskExportError, MAX_EXPORT_FILES } from '@/services/shot-export.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/bay-app/export
 *   { deviceId, delivery: 'APP'|'EMAIL'|'BOTH', bookingId?, phone?, email?, files: [{ name, content }] }
 *
 * The kiosk found GSPro's "Export CSV" output on the bay PC and the player chose
 * to send it to their Tee24 app and/or email it to themselves. Files are parked
 * as ShotDataExport rows; the app imports them on "Sync latest data".
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const deviceId = String(body.deviceId ?? '').trim();
    if (!deviceId) return NextResponse.json({ error: 'deviceId required' }, { status: 400 });
    const deliveryRaw = String(body.delivery ?? 'APP').toUpperCase();
    const delivery = deliveryRaw === 'EMAIL' || deliveryRaw === 'BOTH' ? deliveryRaw : 'APP';
    const filesRaw = Array.isArray(body.files) ? (body.files as unknown[]) : [];
    const files = filesRaw
      .slice(0, MAX_EXPORT_FILES)
      .map((f) => {
        const o = (f ?? {}) as Record<string, unknown>;
        return { name: String(o.name ?? 'gspro-export.csv'), content: String(o.content ?? '') };
      })
      .filter((f) => f.content.trim());

    const result = await intakeKioskExport({
      deviceId,
      delivery,
      bookingId: body.bookingId ? String(body.bookingId) : null,
      phone: body.phone ? String(body.phone) : null,
      email: body.email ? String(body.email) : null,
      files,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof KioskExportError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    console.error('[bay-app/export]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 });
  }
}
