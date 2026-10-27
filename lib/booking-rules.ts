/** Shared booking-limit helpers and member-facing conflict copy. */

export function bookingDurationOptions(min: number, max: number, step: number): number[] {
  const s = Math.max(15, Math.floor(step) || 60);
  const lo = Math.max(s, Math.floor(min) || s);
  const hi = Math.max(lo, Math.floor(max) || lo);
  const out: number[] = [];
  for (let d = lo; d <= hi; d += s) out.push(d);
  return out.length ? out : [lo];
}

export function formatDurationMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return h === 1 ? "1 hour" : `${h} hours`;
  if (h === 0) return `${m} minutes`;
  return `${h}h ${m}m`;
}

export function emptyStartTimes(durations: number[]): Record<number, string[]> {
  return Object.fromEntries(durations.map((d) => [d, [] as string[]]));
}

export function durationOutOfRangeMessage(min: number, max: number): string {
  if (min === max) return `Reservations at this club are ${formatDurationMinutes(min)}.`;
  return `Reservations can be ${formatDurationMinutes(min)} to ${formatDurationMinutes(max)}. Pick a duration in that range.`;
}

export function activeBookingLimitMessage(count: number, max: number): string {
  return `You already have ${count} upcoming reservation${count === 1 ? "" : "s"}. You can hold ${max} at a time — cancel one or wait until one finishes before booking another.`;
}

export function simultaneousBookingMessage(): string {
  return "You already have a reservation during this time. You can only play one bay at a time. Pick a different start time, or cancel the other reservation first.";
}

export function consecutiveBookingMessage(chain: number, max: number): string {
  return `That would be ${chain} reservations in a row. You can book up to ${max} back-to-back. Choose a later start time or a shorter duration.`;
}
