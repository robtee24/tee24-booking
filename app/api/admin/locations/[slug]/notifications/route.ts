// app/api/admin/locations/[slug]/notifications/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// Match your Prisma enums exactly
const CHANNEL = { EMAIL: 'EMAIL', TEXT: 'TEXT' } as const;
const KIND = { CONFIRMATION: 'CONFIRMATION', NOTIFICATION: 'NOTIFICATION' } as const;

// GET: load current config
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ slug: string }> } // 👈 In Next.js 16, params is a Promise
) {
  try {
    const { slug } = await ctx.params; // 👈 Await it
    if (!slug) {
      return NextResponse.json({ error: 'Missing location slug' }, { status: 400 });
    }

    const location = await prisma.location.findUnique({
      where: { slug },
      select: { id: true, name: true, slug: true },
    });
    if (!location) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 });
    }

    const rows = await prisma.notification.findMany({
      where: { locationId: location.id },
      orderBy: [
        { kind: 'asc' },
        { channel: 'asc' },
        { order: 'asc' },
        { hoursBefore: 'asc' },
      ],
      select: {
        id: true,
        kind: true,
        channel: true,
        hoursBefore: true,
        enabled: true,
        template: true,
        order: true,
      },
    });

    // confirmations
    const confEmail = rows.find(
      (r) =>
        r.kind === KIND.CONFIRMATION &&
        r.channel === CHANNEL.EMAIL &&
        r.hoursBefore === 0
    );
    const confText = rows.find(
      (r) =>
        r.kind === KIND.CONFIRMATION &&
        r.channel === CHANNEL.TEXT &&
        r.hoursBefore === 0
    );

    // scheduled
    const scheduledEmails = rows
      .filter(
        (r) =>
          r.kind === KIND.NOTIFICATION &&
          r.channel === CHANNEL.EMAIL &&
          r.hoursBefore > 0
      )
      .map(({ id, hoursBefore, enabled, template, order }) => ({
        id,
        offsetHours: hoursBefore,
        enabled,
        template,
        orderIndex: order,
      }));

    const scheduledTexts = rows
      .filter(
        (r) =>
          r.kind === KIND.NOTIFICATION &&
          r.channel === CHANNEL.TEXT &&
          r.hoursBefore > 0
      )
      .map(({ id, hoursBefore, enabled, template, order }) => ({
        id,
        offsetHours: hoursBefore,
        enabled,
        template,
        orderIndex: order,
      }));

    // 🔹 Helper text payload for the admin UI (so it shows {{start}}/{{end}} as primary)
    const mergeFields = {
      recommended: [
        'firstName',
        'lastName',
        'email',
        'phone',
        'locationName',
        'bayNumber',
        'date',
        'start', // primary
        'end',   // primary
        'bookingNote',
        'manageUrl',
      ],
      aliases: {
        startTime: 'start',
        endTime: 'end',
      },
      notes: {
        email: 'Email templates are HTML. Use <br> for line breaks or proper <p> tags.',
        sms: 'SMS is plain text. Use \\n for line breaks.',
      },
      example: {
        email:
          'Hi {{firstName}},<br>Your booking is confirmed for {{date}} {{start}}–{{end}} at {{locationName}} (Bay {{bayNumber}}).',
        sms:
          'Hi {{firstName}}\\nYour booking is confirmed\\n{{locationName}} Bay {{bayNumber}}\\n{{date}} {{start}}–{{end}}',
      },
    };

    return NextResponse.json({
      location,
      confirmations: {
        email: {
          enabled: confEmail?.enabled ?? false,
          template: confEmail?.template ?? '',
        },
        // Expose as "sms" to the UI, but stored as TEXT in DB
        sms: {
          enabled: confText?.enabled ?? false,
          template: confText?.template ?? '',
        },
      },
      notifications: {
        emails: scheduledEmails,
        texts: scheduledTexts, // stored as TEXT in DB
      },
      mergeFields, // 👈 UI can read this to render accurate helper text
    });
  } catch (e) {
    console.error('GET notifications error', e);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// POST: replace all notifications for a location
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> } // 👈 In Next.js 16, params is a Promise
) {
  try {
    const { slug } = await ctx.params; // 👈 Await it
    if (!slug) {
      return NextResponse.json({ error: 'Missing location slug' }, { status: 400 });
    }

    const location = await prisma.location.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!location) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const cEmail = body?.confirmations?.email ?? { enabled: false, template: '' };
    const cSms = body?.confirmations?.sms ?? { enabled: false, template: '' };
    const nEmails: any[] = Array.isArray(body?.notifications?.emails)
      ? body.notifications.emails
      : [];
    const nTexts: any[] = Array.isArray(body?.notifications?.texts)
      ? body.notifications.texts
      : [];

    await prisma.$transaction(async (tx) => {
      await tx.notification.deleteMany({ where: { locationId: location.id } });

      const data = [
        // confirmations
        {
          locationId: location.id,
          kind: KIND.CONFIRMATION,
          channel: CHANNEL.EMAIL,
          hoursBefore: 0,
          enabled: !!cEmail.enabled,
          template: String(cEmail.template ?? ''),
          order: 0,
        },
        {
          locationId: location.id,
          kind: KIND.CONFIRMATION,
          channel: CHANNEL.TEXT, // stored as TEXT
          hoursBefore: 0,
          enabled: !!cSms.enabled,
          template: String(cSms.template ?? ''),
          order: 0,
        },
        // scheduled emails
        ...nEmails.map((n, idx) => ({
          locationId: location.id,
          kind: KIND.NOTIFICATION,
          channel: CHANNEL.EMAIL,
          hoursBefore: Number(n.offsetHours ?? 0),
          enabled: !!n.enabled,
          template: String(n.template ?? ''),
          order: Number(n.orderIndex ?? idx),
        })),
        // scheduled texts (stored as TEXT)
        ...nTexts.map((n, idx) => ({
          locationId: location.id,
          kind: KIND.NOTIFICATION,
          channel: CHANNEL.TEXT,
          hoursBefore: Number(n.offsetHours ?? 0),
          enabled: !!n.enabled,
          template: String(n.template ?? ''),
          order: Number(n.orderIndex ?? idx),
        })),
      ];

      await tx.notification.createMany({ data });
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('POST notifications error', e);
    return NextResponse.json(
      { error: e?.message ?? 'Server error' },
      { status: 500 }
    );
  }
}
