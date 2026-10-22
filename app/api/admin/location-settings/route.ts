// app/api/admin/location-settings/route.ts
//
//   GET   ?locationSlug=   → { settings }   (no slug → { locations } list)
//   PATCH { locationSlug, ...fields }        → { settings }
//
// Fields: booking rules, hours, bay-app, confirmation templates (legacy) plus
// the location *details* (business name, contact, address, timezone, logo,
// disabled). Any admin who can access the location may read/write.
import { NextResponse } from 'next/server';
import { getPrisma } from '@/lib/db';
import { requireAdminApi, requireLocationAdminApi } from '@/lib/api-auth';
import { audit } from '@/lib/audit';
import { LOCATION_DETAILS_SELECT, sanitizeLocationDetails } from '@/services/location.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ----------------------------- Types & Helpers ----------------------------- */
type DayHours = { day: number; closed?: boolean; open?: string; close?: string };

function clamp(n: unknown, min: number, max: number, def: number) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, v));
}

function isHHMM(s: unknown): s is string {
  return typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);
}

function sanitizeHours(input: unknown): DayHours[] {
  if (!Array.isArray(input)) return [];
  const rows: DayHours[] = [];
  for (const raw of input) {
    const r = raw as Record<string, unknown>;
    const day = Number(r?.day);
    if (!Number.isFinite(day) || day < 0 || day > 6) continue;
    const closed = Boolean(r?.closed);
    const row: DayHours = { day, closed };
    if (!closed) {
      row.open = isHHMM(r?.open) ? (r.open as string) : '09:00';
      row.close = isHHMM(r?.close) ? (r.close as string) : '21:00';
    }
    rows.push(row);
  }
  // normalize to all 7 days
  const defaults: DayHours[] = Array.from({ length: 7 }, (_, d) => ({
    day: d,
    closed: false,
    open: '09:00',
    close: '21:00',
  }));
  const byDay = new Map<number, DayHours>(rows.map((r) => [r.day, r]));
  return defaults.map((d) => byDay.get(d.day) ?? d);
}

function pickDefined<T extends Record<string, unknown>>(src: T) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) if (v !== undefined) out[k] = v;
  return out;
}

function normalizeSlug(s: unknown) {
  return String(s ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\-_\s]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const SETTINGS_SELECT = {
  ...LOCATION_DETAILS_SELECT,
  open24Hours: true,
  hours: true,
  minBookingMinutes: true,
  maxBookingMinutes: true,
  maxActiveBookingsPerGuest: true,
  activeBookingIdentifyBy: true,
  activeBookingWindowHours: true,
  maxConsecutiveBookingsPerGuest: true,
  bayAppEnabled: true,
  bayAppUnlockMinutes: true,
  bayAppWarningMinutes: true,
  bayAppAutoCancelOnTimeout: true,
  createdAt: true,
  updatedAt: true,
} as const;

async function loadSettings(where: { id: string } | { slug: string }) {
  const loc = await getPrisma().location.findUnique({
    where,
    select: {
      ...SETTINGS_SELECT,
      notifications: {
        where: { kind: 'CONFIRMATION', channel: { in: ['EMAIL', 'TEXT'] } },
        select: { channel: true, template: true, enabled: true },
      },
      bays: { select: { number: true }, orderBy: { number: 'asc' } },
    },
  });
  if (!loc) return null;
  const emailConf = loc.notifications.find((n) => n.channel === 'EMAIL');
  const smsConf = loc.notifications.find((n) => n.channel === 'TEXT');
  const { notifications, bays, ...rest } = loc;
  void notifications;
  return {
    ...rest,
    bays: bays.map((b) => b.number),
    emailTemplate: emailConf?.template ?? null,
    smsTemplate: smsConf?.template ?? null,
    emailConfirmationEnabled: !!emailConf?.enabled,
    smsConfirmationEnabled: !!smsConf?.enabled,
  };
}

/* ---------------------------------- GET ----------------------------------- */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = (searchParams.get('locationSlug') || '').trim();

    // LIST MODE
    if (!slug) {
      const guard = await requireAdminApi();
      if (!guard.ok) return guard.response;
      const admin = guard.admin;
      const locations =
        admin.role === 'SCOPED'
          ? await getPrisma().location.findMany({
              where: { id: { in: admin.locations.map((l) => l.locationId) } },
              select: { id: true, name: true, slug: true, disabled: true, timezone: true },
              orderBy: { name: 'asc' },
            })
          : await getPrisma().location.findMany({
              select: { id: true, name: true, slug: true, disabled: true, timezone: true },
              orderBy: { name: 'asc' },
            });
      return NextResponse.json({ locations });
    }

    // SINGLE MODE
    const guard = await requireLocationAdminApi({ locationSlug: slug });
    if (!guard.ok) return guard.response;
    const settings = await loadSettings({ slug });
    if (!settings) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ settings });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 });
  }
}

/* --------------------------------- PATCH ---------------------------------- */
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const currentSlug: string = String(body?.locationSlug ?? '').trim();
    if (!currentSlug) {
      return NextResponse.json({ error: 'Missing locationSlug' }, { status: 400 });
    }

    const guard = await requireLocationAdminApi({ locationSlug: currentSlug });
    if (!guard.ok) return guard.response;

    // Find existing
    const existing = await getPrisma().location.findUnique({
      where: { slug: currentSlug },
      select: LOCATION_DETAILS_SELECT,
    });
    if (!existing) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 });
    }

    // ----- Details (name, contact, address, timezone, branding, disabled) -----
    let details: Record<string, unknown>;
    try {
      details = sanitizeLocationDetails(body);
    } catch (e: unknown) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid details' }, { status: 400 });
    }
    // Only ROOT/FULL may disable/enable a location.
    if (details.disabled !== undefined && guard.admin.role === 'SCOPED') {
      return NextResponse.json({ error: 'Only ROOT/FULL admins can disable a location' }, { status: 403 });
    }

    let nextSlug: string | undefined = undefined;
    if (body.slug !== undefined) {
      const ns = normalizeSlug(body.slug);
      if (!ns) return NextResponse.json({ error: 'Slug cannot be empty' }, { status: 400 });
      if (ns !== existing.slug) {
        const taken = await getPrisma().location.findUnique({ where: { slug: ns }, select: { id: true } });
        if (taken) {
          return NextResponse.json({ error: `Slug "${ns}" is already in use` }, { status: 409 });
        }
      }
      nextSlug = ns;
    }

    // ----- Other fields -----
    const open24Hours = body.open24Hours === undefined ? undefined : Boolean(body.open24Hours);
    let hours: DayHours[] | undefined = undefined;
    if ('hours' in body) hours = sanitizeHours(body.hours);
    if (open24Hours === true) hours = [];

    const minBookingMinutes = body.minBookingMinutes === undefined ? undefined : clamp(body.minBookingMinutes, 30, 720, 60);
    const maxBookingMinutes = body.maxBookingMinutes === undefined ? undefined : clamp(body.maxBookingMinutes, 30, 720, 120);
    const maxActiveBookingsPerGuest = body.maxActiveBookingsPerGuest === undefined ? undefined : clamp(body.maxActiveBookingsPerGuest, 0, 20, 2);
    const activeBookingIdentifyBy = body.activeBookingIdentifyBy === undefined
      ? undefined
      : String(body.activeBookingIdentifyBy).toLowerCase() as 'either' | 'email' | 'phone';
    const activeBookingWindowHours = body.activeBookingWindowHours === undefined ? undefined : clamp(body.activeBookingWindowHours, 1, 720, 24);
    const maxConsecutiveBookingsPerGuest = body.maxConsecutiveBookingsPerGuest === undefined ? undefined : clamp(body.maxConsecutiveBookingsPerGuest, 1, 10, 2);

    const bayAppEnabled = body.bayAppEnabled === undefined ? undefined : Boolean(body.bayAppEnabled);
    const bayAppUnlockMinutes = body.bayAppUnlockMinutes === undefined ? undefined : clamp(body.bayAppUnlockMinutes, 1, 60, 10);
    const bayAppWarningMinutes = body.bayAppWarningMinutes === undefined ? undefined : clamp(body.bayAppWarningMinutes, 1, 60, 5);
    const bayAppAutoCancelOnTimeout = body.bayAppAutoCancelOnTimeout === undefined ? undefined : Boolean(body.bayAppAutoCancelOnTimeout);

    const data = pickDefined({
      ...details,
      slug: nextSlug,
      open24Hours,
      hours,
      minBookingMinutes,
      maxBookingMinutes,
      maxActiveBookingsPerGuest,
      activeBookingIdentifyBy,
      activeBookingWindowHours,
      maxConsecutiveBookingsPerGuest,
      bayAppEnabled,
      bayAppUnlockMinutes,
      bayAppWarningMinutes,
      bayAppAutoCancelOnTimeout,
    });

    const updated = await getPrisma().location.update({
      where: { slug: existing.slug },
      data,
      select: { id: true, slug: true },
    });

    // === Confirmation templates live in the Notification table ===
    if (body.emailTemplate !== undefined || body.smsTemplate !== undefined) {
      await getPrisma().$transaction(async (tx) => {
        for (const [channel, template] of [
          ['EMAIL', body.emailTemplate],
          ['TEXT', body.smsTemplate],
        ] as const) {
          if (template === undefined) continue;
          await tx.notification.upsert({
            where: { locationId_kind_channel_hoursBefore: { locationId: updated.id, kind: 'CONFIRMATION', channel, hoursBefore: 0 } },
            create: { locationId: updated.id, kind: 'CONFIRMATION', channel, hoursBefore: 0, enabled: true, template: String(template ?? ''), order: 0 },
            update: { template: String(template ?? '') },
          });
        }
      });
    }

    if (Object.keys(data).length) {
      const beforeSnap: Record<string, unknown> = {};
      for (const k of Object.keys(data)) beforeSnap[k] = (existing as Record<string, unknown>)[k];
      void audit({
        actorId: guard.admin.id,
        actorRole: guard.admin.role,
        action: 'settings.update',
        entityType: 'Location',
        entityId: updated.id,
        before: beforeSnap,
        after: data,
        metadata: { via: 'location-settings' },
      });
    }

    const settings = await loadSettings({ id: updated.id });
    return NextResponse.json({ settings });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 });
  }
}
