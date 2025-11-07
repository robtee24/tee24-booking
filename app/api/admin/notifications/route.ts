// app/api/admin/notifications/route.ts
import { NextResponse } from 'next/server';
import { getPrisma } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * GET ?locationSlug=clarksville
 * Returns all NOTIFICATION kind rows (email + text) ordered for display.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = (searchParams.get('locationSlug') || '').trim();
    if (!slug) return NextResponse.json({ error: 'Missing locationSlug' }, { status: 400 });

    const loc = await getPrisma().location.findUnique({ where: { slug }, select: { id: true } });
    if (!loc) return NextResponse.json({ error: 'Location not found' }, { status: 404 });

    const notifications = await getPrisma().notification.findMany({
      where: { locationId: loc.id, kind: 'NOTIFICATION' },
      orderBy: [{ hoursBefore: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
    });

    return NextResponse.json({ notifications });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 });
  }
}

/**
 * POST
 * Body: { locationSlug, channel: 'EMAIL'|'TEXT', kind: 'NOTIFICATION', hoursBefore, template, enabled }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const slug = String(body?.locationSlug ?? '').trim();
    const channel = String(body?.channel ?? '').toUpperCase();
    const kind = 'NOTIFICATION';
    const hoursBefore = Number(body?.hoursBefore ?? 2);
    const template = String(body?.template ?? '');
    const enabled = Boolean(body?.enabled ?? true);

    if (!slug) return NextResponse.json({ error: 'Missing locationSlug' }, { status: 400 });
    if (channel !== 'EMAIL' && channel !== 'TEXT')
      return NextResponse.json({ error: 'Invalid channel' }, { status: 400 });

    const loc = await getPrisma().location.findUnique({ where: { slug }, select: { id: true } });
    if (!loc) return NextResponse.json({ error: 'Location not found' }, { status: 404 });

    // set default order at the end
    const maxOrder = await getPrisma().notification.aggregate({
      where: { locationId: loc.id, kind, channel },
      _max: { order: true },
    });

    const notification = await getPrisma().notification.create({
      data: {
        locationId: loc.id,
        kind,
        channel,
        hoursBefore: Math.max(0, Math.min(720, Math.floor(hoursBefore))),
        template,
        enabled,
        order: (maxOrder._max.order ?? 0) + 1,
      },
    });

    return NextResponse.json({ notification });
  } catch (e: any) {
    // Uniqueness on (locationId,kind,channel,hoursBefore) may throw
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 });
  }
}

/**
 * PATCH
 * Body: { id, hoursBefore?, template?, enabled?, order? }
 */
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const id = String(body?.id ?? '').trim();
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const data: any = {};
    if (body.hoursBefore !== undefined)
      data.hoursBefore = Math.max(0, Math.min(720, Math.floor(Number(body.hoursBefore))));
    if (body.template !== undefined) data.template = String(body.template);
    if (body.enabled !== undefined) data.enabled = Boolean(body.enabled);
    if (body.order !== undefined) data.order = Math.max(0, Math.min(99, Math.floor(Number(body.order))));

    const notification = await getPrisma().notification.update({
      where: { id },
      data,
    });

    return NextResponse.json({ notification });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 });
  }
}

/**
 * DELETE
 * Body: { id }
 */
export async function DELETE(req: Request) {
  try {
    const body = await req.json();
    const id = String(body?.id ?? '').trim();
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    await getPrisma().notification.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 });
  }
}
