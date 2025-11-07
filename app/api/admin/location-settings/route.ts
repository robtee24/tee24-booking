// app/api/admin/location-settings/route.ts
import { NextResponse } from 'next/server';
import { getPrisma } from '@/lib/db';

export const runtime = 'nodejs';

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
    const r = raw as any;
    const day = Number(r?.day);
    if (!Number.isFinite(day) || day < 0 || day > 6) continue;
    const closed = Boolean(r?.closed);
    const row: DayHours = { day, closed };
    if (!closed) {
      row.open = isHHMM(r?.open) ? r.open : '09:00';
      row.close = isHHMM(r?.close) ? r.close : '21:00';
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
function pickDefined<T extends Record<string, any>>(src: T) {
  const out: Record<string, any> = {};
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

/* ---------------------------------- GET ----------------------------------- */
/**
 * GET /api/admin/location-settings
 *  - List mode (no ?locationSlug): { locations: [{id,name,slug}] }
 *  - Single mode (?locationSlug=slug): { settings: {...} }
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = (searchParams.get('locationSlug') || '').trim();

    // LIST MODE
    if (!slug) {
      const locations = await getPrisma().location.findMany({
        select: { id: true, name: true, slug: true },
        orderBy: { name: 'asc' },
      });
      return NextResponse.json({ locations });
    }

    // SINGLE MODE
    const loc = await getPrisma().location.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,

        bookingNote: true,
        emailTemplate: true,
        smsTemplate: true,
        passAccessUrl: true, // <-- NEW (read-only exposure)

        open24Hours: true,
        hours: true,

        minBookingMinutes: true,
        maxBookingMinutes: true,
        maxActiveBookingsPerGuest: true,
        activeBookingIdentifyBy: true,
        activeBookingWindowHours: true,
        maxConsecutiveBookingsPerGuest: true,

        bays: { select: { number: true }, orderBy: { number: 'asc' } },

        createdAt: true,
        updatedAt: true,
      },
    });

    if (!loc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({
      settings: {
        ...loc,
        bays: (loc.bays ?? []).map((b) => b.number),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 });
  }
}

/* --------------------------------- PATCH ---------------------------------- */
/**
 * PATCH /api/admin/location-settings
 * Body (partial allowed):
 *   locationSlug: string (required, current slug)
 *   name?: string
 *   slug?: string (new slug)
 *   bookingNote?: string | null
 *   emailTemplate?: string
 *   smsTemplate?: string
 *   passAccessUrl?: string | null           // NEW (optional)
 *   open24Hours?: boolean
 *   hours?: {day,closed,open?,close?}[]
 *   minBookingMinutes?: number (30–720)
 *   maxBookingMinutes?: number (30–720)
 *   maxActiveBookingsPerGuest?: number
 *   activeBookingIdentifyBy?: 'either'|'email'|'phone'
 *   activeBookingWindowHours?: number (1–720)
 *   maxConsecutiveBookingsPerGuest?: number (1–10)
 */
export async function PATCH(req: Request) {
  try {
    const body = await req.json();

    const currentSlug: string = String(body?.locationSlug ?? '').trim();
    if (!currentSlug) {
      return NextResponse.json({ error: 'Missing locationSlug' }, { status: 400 });
    }

    // Find existing
    const existing = await getPrisma().location.findUnique({
      where: { slug: currentSlug },
      select: { id: true, name: true, slug: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 });
    }

    // ----- Name / Slug updates (optional) -----
    let nextName: string | undefined = undefined;
    if (body.name !== undefined) {
      const nm = String(body.name).trim();
      if (!nm) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
      nextName = nm;
    }

    let nextSlug: string | undefined = undefined;
    if (body.slug !== undefined) {
      const ns = normalizeSlug(body.slug);
      if (!ns) return NextResponse.json({ error: 'Slug cannot be empty' }, { status: 400 });
      // If slug changes, enforce uniqueness
      if (ns !== existing.slug) {
        const taken = await getPrisma().location.findUnique({ where: { slug: ns }, select: { id: true } });
        if (taken) {
          return NextResponse.json({ error: `Slug "${ns}" is already in use` }, { status: 409 });
        }
      }
      nextSlug = ns;
    }

    // ----- Other fields -----
    const open24Hours =
      body.open24Hours === undefined ? undefined : Boolean(body.open24Hours);

    let hours: DayHours[] | undefined = undefined;
    if ('hours' in body) hours = sanitizeHours(body.hours);
    if (open24Hours === true) hours = []; // 24/7 -> empty array

    const minBookingMinutes =
      body.minBookingMinutes === undefined ? undefined : clamp(body.minBookingMinutes, 30, 720, 60);
    const maxBookingMinutes =
      body.maxBookingMinutes === undefined ? undefined : clamp(body.maxBookingMinutes, 30, 720, 120);
    const maxActiveBookingsPerGuest =
      body.maxActiveBookingsPerGuest === undefined ? undefined : clamp(body.maxActiveBookingsPerGuest, 0, 20, 2);
    const activeBookingIdentifyBy =
      body.activeBookingIdentifyBy === undefined
        ? undefined
        : String(body.activeBookingIdentifyBy).toLowerCase() as 'either' | 'email' | 'phone';
    const activeBookingWindowHours =
      body.activeBookingWindowHours === undefined ? undefined : clamp(body.activeBookingWindowHours, 1, 720, 24);
    const maxConsecutiveBookingsPerGuest =
      body.maxConsecutiveBookingsPerGuest === undefined ? undefined : clamp(body.maxConsecutiveBookingsPerGuest, 1, 10, 2);

    // NEW passAccessUrl (string or null; empty string -> null)
    let passAccessUrl: string | null | undefined = undefined;
    if ('passAccessUrl' in body) {
      if (body.passAccessUrl === null) {
        passAccessUrl = null;
      } else {
        const s = String(body.passAccessUrl ?? '').trim();
        passAccessUrl = s.length ? s : null;
      }
    }

    const data = pickDefined({
      name: nextName,
      slug: nextSlug,

      bookingNote: body.bookingNote ?? (body.bookingNote === null ? null : undefined),
      emailTemplate: body.emailTemplate,
      smsTemplate: body.smsTemplate,
      passAccessUrl, // <-- NEW

      open24Hours,
      hours,

      minBookingMinutes,
      maxBookingMinutes,
      maxActiveBookingsPerGuest,
      activeBookingIdentifyBy,
      activeBookingWindowHours,
      maxConsecutiveBookingsPerGuest,
    });

    const updated = await getPrisma().location.update({
      where: { slug: existing.slug }, // use current slug to find the row
      data,
      select: {
        id: true,
        name: true,
        slug: true,

        bookingNote: true,
        emailTemplate: true,
        smsTemplate: true,
        passAccessUrl: true, // <-- NEW (return in response)

        open24Hours: true,
        hours: true,

        minBookingMinutes: true,
        maxBookingMinutes: true,
        maxActiveBookingsPerGuest: true,
        activeBookingIdentifyBy: true,
        activeBookingWindowHours: true,
        maxConsecutiveBookingsPerGuest: true,

        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ settings: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 });
  }
}
