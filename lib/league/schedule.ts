/**
 * League calendar. A league week runs Monday 00:00 → Sunday 11:59:59 PM in the
 * location's timezone. The Sunday deadline is hard: no make-up rounds.
 */
import { addDays, addWeeks, startOfDay } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

export type WeekDraft = { weekNumber: number; opensAt: Date; deadlineAt: Date; isChampionship: boolean };

/** Local wall-clock parts → UTC instant for the given timezone. */
function zoned(tz: string, y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): Date {
  return fromZonedTime(new Date(y, m, d, hh, mm, ss), tz);
}

/** The Monday (local) on or before `date`. */
export function mondayOf(date: Date, tz: string): Date {
  const local = startOfDay(toZonedTime(date, tz));
  const dow = local.getDay(); // 0 = Sunday
  const back = dow === 0 ? 6 : dow - 1;
  const mon = addDays(local, -back);
  return zoned(tz, mon.getFullYear(), mon.getMonth(), mon.getDate());
}

/** Sunday 23:59:59 local of the week that starts on `mondayUtc`. */
export function sundayDeadline(mondayUtc: Date, tz: string): Date {
  const monLocal = toZonedTime(mondayUtc, tz);
  const sun = addDays(monLocal, 6);
  return zoned(tz, sun.getFullYear(), sun.getMonth(), sun.getDate(), 23, 59, 59);
}

/**
 * Build `count` consecutive weeks starting the Monday on/before `firstWeekStart`.
 * The last week is flagged as the championship week when `withChampionship`.
 */
export function buildWeeks(firstWeekStart: Date, count: number, tz: string, withChampionship = false): WeekDraft[] {
  const mon0 = mondayOf(firstWeekStart, tz);
  return Array.from({ length: count }, (_, i) => {
    const monLocal = addWeeks(toZonedTime(mon0, tz), i);
    const opensAt = zoned(tz, monLocal.getFullYear(), monLocal.getMonth(), monLocal.getDate());
    return { weekNumber: i + 1, opensAt, deadlineAt: sundayDeadline(opensAt, tz), isChampionship: withChampionship && i === count - 1 };
  });
}

export function fmtDeadline(d: Date, tz: string): string {
  return formatInTimeZone(d, tz, "EEE MMM d, h:mm a");
}

export function fmtDay(d: Date, tz: string): string {
  return formatInTimeZone(d, tz, "EEE MMM d");
}

/** Whole years between `dob` and `at`. */
export function ageAt(dob: Date, at = new Date()): number {
  let age = at.getFullYear() - dob.getFullYear();
  const m = at.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < dob.getDate())) age--;
  return age;
}
