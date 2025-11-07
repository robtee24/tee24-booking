// app/api/availability/route.ts
import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Align to minute-step (e.g., 30)
const STEP_MIN = 30;

function toISO(d: Date) {
  return new Date(d.getTime() - d.getMilliseconds()).toISOString();
}

function startOfDay(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`);
}

type Busy = { start: Date; end: Date };

function normalizeBusy(list: Busy[]): Busy[] {
  if (!list.length) return [];
  const sorted = list.slice().sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Busy[] = [];
  let cur = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i];
    if (n.start <= cur.end) {
      if (n.end > cur.end) cur.end = n.end;
    } else {
      out.push(cur);
      cur = { ...n };
    }
  }
  out.push(cur);
  return out;
}

function invertBusy(busy: Busy[], windowStart: Date, windowEnd: Date): Busy[] {
  if (windowEnd <= windowStart) return [];
  const merged = normalizeBusy(
    busy
      .map((b) => ({
        start: new Date(Math.max(b.start.getTime(), windowStart.getTime())),
        end: new Date(Math.min(b.end.getTime(), windowEnd.getTime())),
      }))
      .filter((b) => b.end > b.start)
  );
  const free: Busy[] = [];
  let cursor = new Date(windowStart);
  for (const b of merged) {
    if (b.start > cursor) free.push({ start: new Date(cursor), end: new Date(b.start) });
    cursor = new Date(Math.max(cursor.getTime(), b.end.getTime()));
  }
  if (cursor < windowEnd) free.push({ start: new Date(cursor), end: new Date(windowEnd) });
  return free;
}

function ceilToStep(d: Date, stepMin = STEP_MIN) {
  const t = new Date(d);
  t.setSeconds(0, 0);
  const m = t.getMinutes();
  const next = Math.ceil(m / stepMin) * stepMin;
  t.setMinutes(next, 0, 0);
  return t;
}

function floorToStep(d: Date, stepMin = STEP_MIN) {
  const t = new Date(d);
  t.setSeconds(0, 0);
  const m = t.getMinutes();
  const prev = Math.floor(m / stepMin) * stepMin;
  t.setMinutes(prev, 0, 0);
  return t;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const locationSlug = searchParams.get("locationSlug") || "";
    const dateStr = searchParams.get("date") || "";
    const kind = (searchParams.get("kind") || "").toUpperCase(); // 'SINGLE' | 'GROUP'
    const hand = (searchParams.get("hand") || "").toUpperCase(); // 'RH' | 'LH' | '' (ignored for GROUP)

    if (!locationSlug) {
      return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
    }
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return NextResponse.json({ error: "date (YYYY-MM-DD) is required" }, { status: 400 });
    }
    if (kind !== "SINGLE" && kind !== "GROUP") {
      return NextResponse.json({ error: "kind must be SINGLE or GROUP" }, { status: 400 });
    }
    if (kind === "SINGLE" && hand !== "RH" && hand !== "LH") {
      return NextResponse.json({ error: "hand must be RH or LH when kind=SINGLE" }, { status: 400 });
    }

    const dayStart = startOfDay(dateStr);
    const dayOfWeek = dayStart.getDay();

    const location = await getPrisma().location.findUnique({
      where: { slug: locationSlug },
      select: {
        id: true,
        open24Hours: true,
        hours: true,
      },
    });
    if (!location) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    // Compute operating window for this day
    let operatingStart: Date;
    let operatingEnd: Date;
    if (location.open24Hours) {
      operatingStart = dayStart;
      operatingEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    } else {
      const dayHours = (location.hours as any[])?.find((h: any) => h.day === dayOfWeek);
      if (!dayHours || dayHours.closed) {
        return NextResponse.json({ slots: [] });
      }
      const [oh, om] = dayHours.open.split(":").map(Number);
      operatingStart = new Date(dayStart);
      operatingStart.setHours(oh, om, 0, 0);
      const [ch, cm] = dayHours.close.split(":").map(Number);
      operatingEnd = new Date(dayStart);
      operatingEnd.setHours(ch, cm, 0, 0);
      if (operatingEnd <= operatingStart) {
        operatingEnd.setDate(operatingEnd.getDate() + 1);
      }
    }

    // Load bays for location with kind/handedness/capacity
    const bays = await getPrisma().bay.findMany({
      where: { locationId: location.id },
      orderBy: { number: "asc" },
      select: { number: true, kind: true, handedness: true, capacity: true },
    });

    // Filter bays by requested party kind + handedness rule
    const eligibleBays = bays.filter((b) => {
      const bKind = (b.kind as any) || "GROUP";
      if (kind === "GROUP") return bKind === "GROUP";
      // SINGLE
      if (bKind !== "SINGLE") return false;
      return (b.handedness || "RH") === hand; // default to RH if null-ish
    });

    if (eligibleBays.length === 0) {
      return NextResponse.json({ slots: [] });
    }

    const bayNumbers = eligibleBays.map((b) => b.number);

    // Fetch existing bookings for those bays that overlap *operating window*
    const bookings = await getPrisma().booking.findMany({
      where: {
        locationId: location.id,
        bayNumber: { in: bayNumbers },
        // any overlap with operating window
        NOT: [
          { end: { lt: operatingStart } },
          { start: { gt: operatingEnd } },
        ],
      },
      orderBy: { start: "asc" },
      select: { bayNumber: true, start: true, end: true },
    });

    // Build busy list per bay
    const busyByBay = new Map<number, Busy[]>();
    for (const bn of bayNumbers) busyByBay.set(bn, []);
    for (const bk of bookings) {
      const arr = busyByBay.get(bk.bayNumber);
      if (!arr) continue;
      arr.push({ start: new Date(bk.start), end: new Date(bk.end) });
    }

    // Create free windows per bay, step-aligned
    type Slot = { start: string; end: string; availableBays: number[] };
    const slots: Slot[] = [];
    for (const bn of bayNumbers) {
      const busy = busyByBay.get(bn) || [];
      const free = invertBusy(busy, operatingStart, operatingEnd);
      for (const f of free) {
        // Align to step so the UI’s step math works perfectly
        const s = ceilToStep(f.start, STEP_MIN);
        const e = floorToStep(f.end, STEP_MIN);
        if (e > s) {
          slots.push({
            start: toISO(s),
            end: toISO(e),
            availableBays: [bn],
          });
        }
      }
    }

    // We could merge identical windows with multiple bays, but the
    // UI de-duplicates times anyway. This keeps it simple & correct.
    return NextResponse.json({ slots });
  } catch (e: any) {
    console.error("availability error", e);
    return NextResponse.json({ error: "Failed to compute availability" }, { status: 500 });
  }
}