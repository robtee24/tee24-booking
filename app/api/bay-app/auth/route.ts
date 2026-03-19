import { NextResponse } from 'next/server';
import { getPrisma } from '@/lib/db';
import { otpService } from '@/services/otp.service';
import { toE164 } from '@/lib/phone';

export const runtime = 'nodejs';

/**
 * POST /api/bay-app/auth
 * Two-phase admin auth for the desktop bay app.
 *   Phase 1 (action: "send-otp"):  send OTP to admin phone
 *   Phase 2 (action: "verify-otp"): verify OTP + check admin access to location
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = String(body?.action ?? '');

    if (action === 'send-otp') {
      const phone = String(body?.phone ?? '').trim();
      if (!phone) {
        return NextResponse.json({ error: 'Phone number required' }, { status: 400 });
      }
      const { expiresAt } = await otpService.requestOtp(phone, 'admin_login');
      return NextResponse.json({ ok: true, expiresAt });
    }

    if (action === 'verify-otp') {
      const phone = String(body?.phone ?? '').trim();
      const code = String(body?.code ?? '').trim();
      const locationId = String(body?.locationId ?? '').trim();

      if (!phone || !code) {
        return NextResponse.json({ error: 'Phone and code required' }, { status: 400 });
      }
      if (!locationId) {
        return NextResponse.json({ error: 'locationId required' }, { status: 400 });
      }

      const verifyResult = await otpService.verifyOtp(phone, code);
      if (!verifyResult.ok) {
        const msg =
          verifyResult.reason === 'EXPIRED' ? 'Code has expired' :
          verifyResult.reason === 'INVALID_FORMAT' ? 'Code must be 6 digits' :
          'Invalid code';
        return NextResponse.json({ error: msg }, { status: 401 });
      }

      const normalizedPhone = toE164(phone);
      const admin = await getPrisma().admin.findUnique({
        where: { phone: normalizedPhone },
        select: { id: true, role: true, locations: { select: { locationId: true } } },
      });

      if (!admin) {
        return NextResponse.json({ error: 'Not authorized as admin' }, { status: 403 });
      }

      const hasAccess =
        admin.role === 'ROOT' ||
        admin.role === 'FULL' ||
        admin.locations.some((l) => l.locationId === locationId);

      if (!hasAccess) {
        return NextResponse.json({ error: 'No access to this location' }, { status: 403 });
      }

      return NextResponse.json({ ok: true, adminId: admin.id, role: admin.role });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (e: any) {
    console.error('[bay-app/auth]', e);
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 });
  }
}
