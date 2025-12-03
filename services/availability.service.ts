// services/availability.service.ts
import { getPrisma } from "@/lib/db";
import {
  toZonedTime,
  fromZonedTime,
  startOfDay,
  isWithinInterval,
} from "date-fns-tz";
import { 
  addDays,
  addMinutes, 
} from "date-fns";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export type AvailabilityRequest = {
  locationSlug: string;
  date: string; // YYYY-MM-DD in UTC
  kind: "SINGLE" | "GROUP";
  hand?: "RH" | "LH";
};

export type TimeSlot = {
  start: string; // ISO UTC
  end: string;   // ISO UTC
  availableCount: number;
};

export type StartTimes = Record<30 | 60 | 90 | 120, string[]>; // HH:mm strings

export type AvailabilityResult = {
  slots: TimeSlot[];
  startTimes: StartTimes;
};

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const STEP_MINUTES = 30;
const DURATIONS = [30, 60, 90, 120] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Core availability engine
// ─────────────────────────────────────────────────────────────────────────────
export async function getAvailability(
  req: AvailabilityRequest
): Promise<AvailabilityResult> {
  const { locationSlug, date: dateStr, kind, hand } = req;

  // 1. Load location + bays
  const location = await getPrisma().location.findUnique({
    where: { slug: locationSlug },
    select: {
      id: true,
      timezone: true,
      open24Hours: true,
      hours: true,
    },
  });

  if (!location) throw new Error("Location not found");
  if (!location.timezone) throw new Error("Location has no timezone");

  const tz = location.timezone;
  const localDateMidnight = toZonedTime(new Date(`${dateStr}T00:00:00Z`), tz);

  // 2. Determine eligible bay numbers
  const bays = await getPrisma().bay.findMany({
    where: { locationId: location.id },
    select: { number: true, kind: true, handedness: true },
  });

  const eligibleBayNumbers = bays
    .filter((b) => {
      if (kind === "GROUP") return b.kind === "GROUP";
      return b.kind === "SINGLE" && (!hand || b.handedness === hand);
    })
    .map((b) => b.number);

  if (eligibleBayNumbers.length === 0) {
    return { slots: [], startTimes: { 30: [], 60: [], 90: [], 120: [] } };
  }

  // 3. Build operating windows (today + tomorrow for overnight)
  const operatingWindows = buildOperatingWindows(localDateMidnight, location);
  if (operatingWindows.length === 0) {
    return { slots: [], startTimes: { 30: [], 60: [], 90: [], 120: [] } };
  }

  const searchStartLocal = operatingWindows[0].start;
  const searchEndLocal = operatingWindows[operatingWindows.length - 1].end;

  const searchStartUtc = fromZonedTime(searchStartLocal, tz);
  const searchEndUtc = fromZonedTime(searchEndLocal, tz);

  // 4. Load all bookings that overlap the search window
  const bookings = await getPrisma().booking.findMany({
    where: {
      locationId: location.id,
      bayNumber: { in: eligibleBayNumbers },
      NOT: [{ end: { lte: searchStartUtc } }, { start: { gte: searchEndUtc } }],
      canceledAt: null,
    },
    select: { bayNumber: true, start: true, end: true },
  });

  // 5. Build busy blocks per bay
  const busyByBay = new Map<number, { start: Date; end: Date }[]>();
  for (const n of eligibleBayNumbers) busyByBay.set(n, []);
  for (const b of bookings) {
    busyByBay.get(b.bayNumber)!.push({ start: b.start, end: b.end });
  }

  // 6. Invert to free windows (across all eligible bays)
  const allFreeUtc = invertBusyAcrossBays(
    Array.from(busyByBay.entries()).map(([bayNumber, busy]) => ({
      bayNumber,
      busy: normalizeBusy(busy),
    })),
    searchStartUtc,
    searchEndUtc
  );

  // 7. Filter free windows by operating hours (unless open24Hours)
  const validFreeLocal = allFreeUtc
    .map((f) => ({
      start: toZonedTime(f.start, tz),
      end: toZonedTime(f.end, tz),
    }))
    .filter((f) => {
      if (location.open24Hours) return true;
      return isLocationOpenAt(f.start, operatingWindows) && isLocationOpenAt(f.end, operatingWindows);
    });

  // 8. Generate aligned free slots
  const alignedFreeUtc = validFreeLocal.flatMap((f) => {
    const start = alignToStep(f.start, STEP_MINUTES, "ceil");
    const end = alignToStep(f.end, STEP_MINUTES, "floor");
    if (end.getTime() <= start.getTime()) return [];
    return [{ start: fromZonedTime(start, tz), end: fromZonedTime(end, tz) }];
  });

  const mergedFreeUtc = normalizeBusy(alignedFreeUtc);

  // 9. Generate startTimes for each duration
  const startTimes: StartTimes = { 30: [], 60: [], 90: [], 120: [] };

  for (const duration of DURATIONS) {
    const valid: string[] = [];
    let cursor = new Date(searchStartLocal);

    while (cursor < searchEndLocal) {
      const candidateStart = alignToStep(cursor, STEP_MINUTES, "ceil");
      const candidateEnd = addMinutes(candidateStart, duration);

      if (candidateEnd > searchEndLocal) break;

      if (
        !location.open24Hours &&
        (!isLocationOpenAt(candidateStart, operatingWindows) ||
          !isLocationOpenAt(candidateEnd, operatingWindows))
      ) {
        cursor = addMinutes(candidateStart, STEP_MINUTES);
        continue;
      }

      const startUtc = fromZonedTime(candidateStart, tz);
      const endUtc = fromZonedTime(candidateEnd, tz);

      const hasFreeBay = mergedFreeUtc.some(
        (block) => block.start <= startUtc && block.end >= endUtc
      );

      if (hasFreeBay) {
        valid.push(toHHMM(candidateStart));
      }

      cursor = addMinutes(candidateStart, STEP_MINUTES);
    }

    startTimes[duration] = Array.from(new Set(valid)).sort();
  }

  // 10. Final slots with availableCount
  const slots: TimeSlot[] = mergedFreeUtc.map((block) => {
    const overlappingBays = new Set<number>();
    for (const [bayNumber, busy] of busyByBay.entries()) {
      if (busy.some((b) => b.start < block.end && b.end > block.start)) {
        overlappingBays.add(bayNumber);
      }
    }
    return {
      start: block.start.toISOString(),
      end: block.end.toISOString(),
      availableCount: eligibleBayNumbers.length - overlappingBays.size,
    };
  });

  return { slots, startTimes };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function buildOperatingWindows(
  localMidnight: Date,
  location: { open24Hours: boolean; hours: any }
): { start: Date; end: Date }[] {
  if (location.open24Hours) {
    return [{ start: localMidnight, end: addDays(localMidnight, 2) }];
  }

  const windows: { start: Date; end: Date }[] = [];
  const hoursArray = Array.isArray(location.hours)
    ? location.hours
    : typeof location.hours === "object"
    ? Object.values(location.hours)
    : [];

  for (let i = 0; i < 2; i++) {
    const day = addDays(localMidnight, i);
    const dayOfWeek = day.getDay();
    const dayHours = hoursArray.find((h: any) => h.day === dayOfWeek);
    if (!dayHours || dayHours.closed) continue;

    const [openH, openM] = dayHours.open.split(":").map(Number);
    const [closeH, closeM] = dayHours.close.split(":").map(Number);

    const open = new Date(day);
    open.setHours(openH, openM, 0, 0);

    let close = new Date(day);
    close.setHours(closeH, closeM, 0, 0);
    if (close <= open) close = addDays(close, 1);

    windows.push({ start: open, end: close });
  }

  return windows;
}

function normalizeBusy(busy: { start: Date; end: Date }[]): { start: Date; end: Date }[] {
  if (!busy.length) return [];
  const sorted = busy.slice().sort((a, b) => a.start.getTime() - b.start.getTime());
  const result: typeof busy = [];
  let current = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    if (next.start <= current.end) {
      current.end = next.end > current.end ? next.end : current.end;
    } else {
      result.push(current);
      current = { ...next };
    }
  }
  result.push(current);
  return result;
}

function invertBusyAcrossBays(
  bays: { bayNumber: number; busy: { start: Date; end: Date }[] }[],
  windowStart: Date,
  windowEnd: Date
): { start: Date; end: Date }[] {
  const allBusy = bays.flatMap((b) => b.busy);
  return invertBusy(allBusy, windowStart, windowEnd);
}

function invertBusy(
  busy: { start: Date; end: Date }[],
  windowStart: Date,
  windowEnd: Date
): { start: Date; end: Date }[] {
  const merged = normalizeBusy(
    busy
      .map((b) => ({
        start: new Date(Math.max(b.start.getTime(), windowStart.getTime())),
        end: new Date(Math.min(b.end.getTime(), windowEnd.getTime())),
      }))
      .filter((b) => b.end > b.start)
  );

  const free: { start: Date; end: Date }[] = [];
  let cursor = new Date(windowStart);

  for (const block of merged) {
    if (block.start > cursor) {
      free.push({ start: new Date(cursor), end: new Date(block.start) });
    }
    cursor = block.end > cursor ? block.end : cursor;
  }

  if (cursor < windowEnd) {
    free.push({ start: new Date(cursor), end: new Date(windowEnd) });
  }

  return free;
}

function alignToStep(date: Date, step: number, mode: "ceil" | "floor" = "ceil"): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  const minutes = d.getMinutes();
  const aligned = mode === "ceil" ? Math.ceil(minutes / step) : Math.floor(minutes / step);
  d.setMinutes(aligned * step, 0, 0);
  return d;
}

function isLocationOpenAt(date: Date, windows: { start: Date; end: Date }[]): boolean {
  return windows.some((w) => date >= w.start && date < w.end);
}

function toHHMM(date: Date): string {
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}