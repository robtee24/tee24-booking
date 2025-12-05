// services/availability.service.ts
import { getPrisma } from "@/lib/db";
import {
  toZonedTime,
  fromZonedTime,
  formatInTimeZone,
} from "date-fns-tz";
import { addDays, addMinutes, parse, format } from "date-fns";
import type {
  AvailabilityRequest,
  AvailabilityResult,
  AvailableBaysResult,
  TimeSlot,
  StartTimes,
} from "@/types/availability";

const STEP_MINUTES = 30;
const DURATIONS = [30, 60, 90, 120] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Align a UTC date to the next step boundary based on local time minutes
// ─────────────────────────────────────────────────────────────────────────────
function alignToLocalStep(
  utcDate: Date,
  step: number,
  mode: "ceil" | "floor",
  tz: string
): Date {
  const localMinutes = Number(formatInTimeZone(utcDate, tz, "mm"));
  const alignedMinutes =
    mode === "ceil"
      ? Math.ceil(localMinutes / step) * step
      : Math.floor(localMinutes / step) * step;
  const diffMinutes = alignedMinutes - localMinutes;
  return addMinutes(utcDate, diffMinutes);
}

// ─────────────────────────────────────────────────────────────────────────────
// Used ONLY by admin to check if a specific bay is free at an exact window */
// ─────────────────────────────────────────────────────────────────────────────
export async function isSpecificBayAvailableAtExactWindow(params: {
  locationId: string;
  bayNumber: number;
  startUTC: Date;
  endUTC: Date;
  ignoreBookingId?: string;   // for updates/moves
}): Promise<boolean> {
  const overlapping = await getPrisma().booking.findFirst({
    where: {
      locationId: params.locationId,
      bayNumber: params.bayNumber,
      canceledAt: null,
      ...(params.ignoreBookingId && { id: { not: params.ignoreBookingId } }),
      start: { lt: params.endUTC },
      end: { gt: params.startUTC },
    },
  });

  return !overlapping;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exact window check (used when creating a booking)
// ─────────────────────────────────────────────────────────────────────────────
export async function getAvailableBaysAtExactWindow(
  req: {
    locationSlug: string;
    startUTC: Date;
    endUTC: Date;
    kind: "SINGLE" | "GROUP";
    hand?: "RH" | "LH";
    ignoreBookingId?: string;
  }
): Promise<AvailableBaysResult> {
  const { locationSlug, startUTC, endUTC, kind, hand, ignoreBookingId } = req;

  if (endUTC <= startUTC) return { availableCount: 0, freeBayNumbers: [] };

  const location = await getPrisma().location.findUnique({
    where: { slug: locationSlug },
    select: { id: true, timezone: true, open24Hours: true, hours: true },
  });
  if (!location || !location.timezone) return { availableCount: 0, freeBayNumbers: [] };

  const tz = location.timezone;

  // Get local date for startUTC to build windows around the correct local day
  const localDatePart = formatInTimeZone(startUTC, tz, "yyyy-MM-dd");
  const localMidnightLocal = parse(`${localDatePart} 00:00:00`, "yyyy-MM-dd HH:mm:ss", new Date());
  const localMidnightUTC = fromZonedTime(localMidnightLocal, tz);
  const operatingWindows = buildOperatingWindows(localMidnightUTC, location, tz);

  if (
    !location.open24Hours &&
    (!operatingWindows.some((w) => startUTC >= w.start && startUTC < w.end) ||
      !operatingWindows.some((w) => endUTC > w.start && endUTC <= w.end))
  ) {
    return { availableCount: 0, freeBayNumbers: [] };
  }

  const [bays, bookings] = await Promise.all([
    getPrisma().bay.findMany({
      where: { locationId: location.id, disabled: false },
      select: { number: true, kind: true, handedness: true },
    }),
    getPrisma().booking.findMany({
      where: {
        locationId: location.id,
        canceledAt: null,
        start: { lt: endUTC },
        end: { gt: startUTC },
        ...(ignoreBookingId ? { id: { not: ignoreBookingId } } : {}),
      },
      select: { bayNumber: true, start: true, end: true },
    }),
  ]);

  const eligibleBayNumbers = getEligibleBayNumbers(bays, kind, hand);
  if (eligibleBayNumbers.length === 0) return { availableCount: 0, freeBayNumbers: [] };

  const busyByBay = new Map<number, { start: Date; end: Date }[]>();
  for (const num of eligibleBayNumbers) busyByBay.set(num, []);

  for (const b of bookings) {
    if (eligibleBayNumbers.includes(b.bayNumber)) {
      busyByBay.get(b.bayNumber)!.push({ start: b.start, end: b.end });
    }
  }

  const isBayFree = (bayNumber: number): boolean => {
    const intervals = busyByBay.get(bayNumber)!;
    return !intervals.some((i) => i.start < endUTC && i.end > startUTC);
  };

  const freeBayNumbers = eligibleBayNumbers.filter(isBayFree).sort((a, b) => a - b);

  if (process.env.NODE_ENV !== "production" || process.env.DEBUG_AVAILABILITY) {
    const busyBays = eligibleBayNumbers.filter(n => !freeBayNumbers.includes(n));
    console.log("  Eligible bay numbers:", eligibleBayNumbers);
    console.log("  Free bay numbers:", freeBayNumbers);
    console.log("  Busy bay numbers:", busyBays);
    console.log("  Final result → availableCount:", freeBayNumbers.length);
    console.log("────────────────────────────────────");
    }

  return { availableCount: freeBayNumbers.length, freeBayNumbers };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main availability for a full day
// ─────────────────────────────────────────────────────────────────────────────
export async function getAvailability(
  req: AvailabilityRequest
): Promise<AvailabilityResult> {
  const {
    locationSlug,
    date: dateStr,
    kind,
    hand,
    includeSlots = false,
    includeFreeBays = false,
  } = req;

  const location = await getPrisma().location.findUnique({
    where: { slug: locationSlug },
    select: { id: true, timezone: true, open24Hours: true, hours: true },
  });
  if (!location || !location.timezone) throw new Error("Location not found or missing timezone");

  const tz = location.timezone;

  // Local midnight UTC timestamp
  const localMidnightLocal = parse(`${dateStr} 00:00:00`, "yyyy-MM-dd HH:mm:ss", new Date());
  const localMidnightUTC = fromZonedTime(localMidnightLocal, tz);

  // Next day midnight UTC timestamp
  const nextDayStr = format(addDays(parse(dateStr, "yyyy-MM-dd", new Date()), 1), "yyyy-MM-dd");
  const dayEndLocal = parse(`${nextDayStr} 00:00:00`, "yyyy-MM-dd HH:mm:ss", new Date());
  const dayEndUTC = fromZonedTime(dayEndLocal, tz);

  const operatingWindows = buildOperatingWindows(localMidnightUTC, location, tz);
  if (operatingWindows.length === 0) {
    return {
      startTimes: { 30: [], 60: [], 90: [], 120: [] },
      ...(includeSlots && { slots: [] }),
      ...(includeFreeBays && { freeBaysBySlot: {} }),
    };
  }

  const dayStartUTC = operatingWindows[0].start;

  const [bays, bookings] = await Promise.all([
    getPrisma().bay.findMany({
      where: { locationId: location.id, disabled: false },
      select: { number: true, kind: true, handedness: true },
    }),
    getPrisma().booking.findMany({
      where: {
        locationId: location.id,
        canceledAt: null,
        start: { lt: dayEndUTC },
        end: { gt: dayStartUTC },
      },
      select: { bayNumber: true, start: true, end: true },
    }),
  ]);

  const eligibleBayNumbers = getEligibleBayNumbers(bays, kind, hand);
  if (eligibleBayNumbers.length === 0) {
    return {
      startTimes: { 30: [], 60: [], 90: [], 120: [] },
      ...(includeSlots && { slots: [] }),
      ...(includeFreeBays && { freeBaysBySlot: {} }),
    };
  }

  const busyByBay = new Map<number, { start: Date; end: Date }[]>();
  for (const num of eligibleBayNumbers) busyByBay.set(num, []);

  for (const b of bookings) {
    if (eligibleBayNumbers.includes(b.bayNumber)) {
      busyByBay.get(b.bayNumber)!.push({ start: b.start, end: b.end });
    }
  }

  const isBayFree = (bayNumber: number, startUTC: Date, endUTC: Date): boolean => {
    const intervals = busyByBay.get(bayNumber) || [];
    return !intervals.some((i) => i.start < endUTC && i.end > startUTC);
  };

  const startTimes: StartTimes = { 30: [], 60: [], 90: [], 120: [] };
  const slots: TimeSlot[] | undefined = includeSlots ? [] : undefined;
  const freeBaysBySlot: Record<string, number[]> | undefined = includeFreeBays ? {} : undefined;

  let cursorUTC = dayStartUTC;
  while (cursorUTC < dayEndUTC) {
    const startUTC = alignToLocalStep(cursorUTC, STEP_MINUTES, "ceil", tz);

    let activeWindow: { start: Date; end: Date } | undefined;
    if (!location.open24Hours) {
      activeWindow = operatingWindows.find((w) => startUTC >= w.start && startUTC < w.end);
      if (!activeWindow) {
        cursorUTC = addMinutes(startUTC, STEP_MINUTES);
        continue;
      }
    }

    for (const duration of DURATIONS) {
      const endUTC = addMinutes(startUTC, duration);
      if (endUTC > addMinutes(dayEndUTC, 120)) continue;
      if (!location.open24Hours && endUTC > activeWindow!.end) continue;

      const freeBayNumbers = eligibleBayNumbers
        .filter((n) => isBayFree(n, startUTC, endUTC))
        .sort((a, b) => a - b);

      if (freeBayNumbers.length > 0) {
        const timeStr = formatInTimeZone(startUTC, tz, "HH:mm");
        if (!startTimes[duration].includes(timeStr)) {
          startTimes[duration].push(timeStr);
        }
        if (includeSlots && slots) {
          slots.push({
            start: startUTC.toISOString(),
            end: endUTC.toISOString(),
            availableCount: freeBayNumbers.length,
          });
        }
        if (includeFreeBays && freeBaysBySlot) {
          const key = `${startUTC.toISOString()}|${duration}`;
          freeBaysBySlot[key] = freeBayNumbers;
        }
      }
    }

    cursorUTC = addMinutes(startUTC, STEP_MINUTES);
  }

  for (const d of DURATIONS) startTimes[d].sort();

  return {
    startTimes,
    ...(includeSlots && slots ? { slots } : {}),
    ...(includeFreeBays && freeBaysBySlot ? { freeBaysBySlot } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
export function getEligibleBayNumbers(
  bays: { number: number; kind: string; handedness: string | null }[],
  kind: "SINGLE" | "GROUP",
  handedness?: "RH" | "LH"
): number[] {
  return bays
    .filter((bay) => {
      if (kind === "GROUP") return bay.kind === "GROUP";
      if (bay.kind !== "SINGLE") return false;
      if (handedness !== undefined) return bay.handedness === handedness;
      return bay.handedness !== "LH"; // default: prefer RH for undefined handedness
    })
    .map((b) => b.number);
}

function buildOperatingWindows(localMidnightUTC: Date, location: any, tz: string): { start: Date; end: Date }[] {
  if (location.open24Hours) {
    return [{ start: localMidnightUTC, end: addDays(localMidnightUTC, 2) }];
  }

  const windows: { start: Date; end: Date }[] = [];
  const hoursArray = Array.isArray(location.hours)
    ? location.hours
    : typeof location.hours === "object"
    ? Object.values(location.hours)
    : [];

  for (let i = 0; i < 2; i++) {
    const dayUTC = addDays(localMidnightUTC, i);
    const dayLocalDate = formatInTimeZone(dayUTC, tz, "yyyy-MM-dd");
    const dayOfWeek = Number(formatInTimeZone(dayUTC, tz, "i")) - 1; // 0=Sun
    const dayHours = hoursArray.find((h: any) => h.day === dayOfWeek);
    if (!dayHours || dayHours.closed) continue;

    const openLocalStr = `${dayLocalDate} ${dayHours.open}:00`;
    const closeLocalStr = `${dayLocalDate} ${dayHours.close}:00`;
    const openLocal = parse(openLocalStr, "yyyy-MM-dd HH:mm:ss", new Date());
    let closeLocal = parse(closeLocalStr, "yyyy-MM-dd HH:mm:ss", new Date());

    const openUTC = fromZonedTime(openLocal, tz);
    let closeUTC = fromZonedTime(closeLocal, tz);

    if (closeUTC <= openUTC) {
      closeLocal = addDays(closeLocal, 1);
      closeUTC = fromZonedTime(closeLocal, tz);
    }

    windows.push({ start: openUTC, end: closeUTC });
  }

  return windows;
}