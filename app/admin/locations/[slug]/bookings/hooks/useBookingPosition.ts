// app/admin/locations/[slug]/bookings/hooks/useBookingPosition.ts
import { useCallback, useMemo } from "react";
import type { AdminBooking } from "@/types/admin-booking";

type Options = {
  date: Date | null | undefined;
  timezone: string;
  pxPerMin: number;
};

export function useBookingPosition({ date, timezone, pxPerMin }: Options) {
  // Midnight of the displayed day IN THE LOCATION'S TIMEZONE → UTC timestamp
  const dayStartUtc = useMemo<number | null>(() => {
    if (!date || isNaN(date.getTime())) return null;

    // Force the date into the location's timezone and read year/month/day
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);

    const year = Number(parts.find(p => p.type === "year")!.value);
    const month = Number(parts.find(p => p.type === "month")!.value);
    const day = Number(parts.find(p => p.type === "day")!.value);

    // Tentative midnight UTC for the local y-m-d (without offset adjustment yet)
    const tentativeUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0);

    // Get the timezone offset at this date (handles DST)
    const offsetFormatter = new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      timeZoneName: "longOffset",
    });
    const partsWithOffset = offsetFormatter.formatToParts(new Date(tentativeUtcMs));
    const offsetPart = partsWithOffset.find(p => p.type === "timeZoneName")?.value || "GMT";

    // Parse offset like "GMT-05:00", "GMT+05:00", or "GMT"
    let offsetInMinutes = 0;
    const match = offsetPart.match(/GMT([+-])?(\d{1,2})?(:(\d{2}))?/);
    if (match) {
      const sign = match[1] === "-" ? -1 : 1;
      const hours = Number(match[2] || 0);
      const minutes = Number(match[4] || 0);
      offsetInMinutes = sign * (hours * 60 + minutes);
    }

    // Adjust: dayStartUtc = tentativeUtcMs - (offsetInMinutes * 60000)
    // This gets the correct UTC for local midnight
    return tentativeUtcMs - offsetInMinutes * 60000;
  }, [date, timezone]);

  const getBookingPosition = useCallback(
    (booking: AdminBooking): { top: number; height: number } | null => {
      if (dayStartUtc === null) return null;
      const dayEndUtc = dayStartUtc + 24 * 60 * 60 * 1000;
      const startUtc = new Date(booking.start).getTime();
      const endUtc = new Date(booking.end).getTime();
      const overlapStart = Math.max(startUtc, dayStartUtc);
      const overlapEnd = Math.min(endUtc, dayEndUtc);
      // No overlap with this calendar day → hide
      if (overlapEnd <= overlapStart) return null;
      const minsFromStart = (overlapStart - dayStartUtc) / 60_000;
      const durationMins = (overlapEnd - overlapStart) / 60_000;
      const top = Math.round(minsFromStart * pxPerMin);
      const height = Math.max(Math.round(durationMins * pxPerMin), 28); // min 28px
      return { top, height };
    },
    [dayStartUtc, pxPerMin]
  );

  return { getBookingPosition };
}