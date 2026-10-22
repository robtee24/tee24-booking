import { NextResponse } from 'next/server';
import { getPrisma } from '@/lib/db';
import { otpService } from '@/services/otp.service';
import { toE164 } from '@/lib/phone';
import { issueBayAdminToken, getBayAdmin } from '@/lib/bay-app/admin-token';

export const runtime = 'nodejs';

/**
 * POST /api/bay-app/auth — admin sign-in for the bay kiosk (Quo SMS one-time code).
 *   { action: "send-otp",   phone }
 *   { action: "verify-otp", phone, code }  -> { ok, token, admin, locations }
 *
 * GET  /api/bay-app/auth  (Authorization: Bearer <token>) -> { ok, admin, locations }
 *   Lets the kiosk re-validate a stored token and refresh the location/bay list.
 *
 * Only phone numbers that belong to an Admin row can sign in. Locations
 * returned are limited to what that admin can manage.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? '');

    if (action === 'send-otp') {
      const phone = String(body?.phone ?? '').trim();
      if (!phone) return NextResponse.json({ error: 'Phone number required' }, { status: 400 });

      // Don't reveal whether a number is an admin; always respond ok, but only send if it is.
      const normalized = safeE164(phone);
      const admin = normalized
        ? await getPrisma().admin.findUnique({ where: { phone: normalized }, select: { id: true } })
        : null;
      if (admin) {
        const { expiresAt } = await otpService.requestOtp(phone, 'admin_login');
        return NextResponse.json({ ok: true, expiresAt });
      }
      return NextResponse.json({ ok: true });
    }

    if (action === 'verify-otp') {
      const phone = String(body?.phone ?? '').trim();
      const code = String(body?.code ?? '').trim();
      if (!phone || !code) return NextResponse.json({ error: 'Phone and code required' }, { status: 400 });

      const verifyResult = await otpService.verifyOtp(phone, code);
      if (!verifyResult.ok) {
        const msg =
          verifyResult.reason === 'EXPIRED' ? 'Code has expired' :
          verifyResult.reason === 'INVALID_FORMAT' ? 'Code must be 6 digits' :
          'Invalid code';
        return NextResponse.json({ error: msg }, { status: 401 });
      }

      const normalized = safeE164(phone);
      const admin = normalized
        ? await getPrisma().admin.findUnique({
            where: { phone: normalized },
            select: { id: true, name: true, role: true, locations: { select: { locationId: true } } },
          })
        : null;
      if (!admin) return NextResponse.json({ error: 'Not authorized as admin' }, { status: 403 });

      const token = await issueBayAdminToken(admin.id);
      const locations = await accessibleLocations(admin.role, admin.locations.map((l) => l.locationId));
      return NextResponse.json({
        ok: true,
        token,
        admin: { id: admin.id, name: admin.name, role: admin.role },
        locations,
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (e: unknown) {
    console.error('[bay-app/auth]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const admin = await getBayAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const locations = await accessibleLocations(admin.role, admin.locationIds);
  return NextResponse.json({ ok: true, admin: { id: admin.id, name: admin.name, role: admin.role }, locations });
}

function safeE164(phone: string): string | null {
  try {
    return toE164(phone);
  } catch {
    return null;
  }
}

async function accessibleLocations(role: string, locationIds: string[]) {
  const full = role === 'ROOT' || role === 'FULL';
  const rows = await getPrisma().location.findMany({
    where: { disabled: false, ...(full ? {} : { id: { in: locationIds } }) },
    select: {
      id: true,
      name: true,
      slug: true,
      bayAppEnabled: true,
      bays: {
        where: { disabled: false },
        select: { id: true, number: true, name: true, launchMonitor: true, setupNotes: true },
        orderBy: { number: 'asc' },
      },
      bayAppRegistrations: { select: { bayNumber: true, deviceId: true, hostname: true, lastSeenAt: true } },
    },
    orderBy: { name: 'asc' },
  });
  return rows;
}
