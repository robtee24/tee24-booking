import { NextResponse } from 'next/server';
import { getPrisma } from '@/lib/db';
import { getBayAdmin, bayAdminCanAccess } from '@/lib/bay-app/admin-token';

export const runtime = 'nodejs';

/**
 * DELETE /api/bay-app/unregister?deviceId=...  (Authorization: Bearer <bay admin token>)
 * Remove a kiosk's bay assignment. Admin-only.
 */
export async function DELETE(req: Request) {
  try {
    const admin = await getBayAdmin(req);
    if (!admin) return NextResponse.json({ error: 'Admin sign-in required' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const deviceId = (searchParams.get('deviceId') ?? '').trim();
    if (!deviceId) return NextResponse.json({ error: 'deviceId required' }, { status: 400 });

    const existing = await getPrisma().bayAppRegistration.findUnique({ where: { deviceId } });
    if (!existing) return NextResponse.json({ ok: true, removed: false });
    if (!bayAdminCanAccess(admin, existing.locationId)) {
      return NextResponse.json({ error: 'No access to this location' }, { status: 403 });
    }

    await getPrisma().bayAppRegistration.delete({ where: { deviceId } });
    return NextResponse.json({ ok: true, removed: true });
  } catch (e: unknown) {
    console.error('[bay-app/unregister]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 });
  }
}
