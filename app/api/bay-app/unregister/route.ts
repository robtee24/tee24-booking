import { NextResponse } from 'next/server';
import { getPrisma } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * DELETE /api/bay-app/unregister?deviceId=...
 * Remove a bay app registration.
 */
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const deviceId = (searchParams.get('deviceId') ?? '').trim();

    if (!deviceId) {
      return NextResponse.json({ error: 'deviceId required' }, { status: 400 });
    }

    const existing = await getPrisma().bayAppRegistration.findUnique({
      where: { deviceId },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 });
    }

    await getPrisma().bayAppRegistration.delete({
      where: { deviceId },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[bay-app/unregister]', e);
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 });
  }
}
