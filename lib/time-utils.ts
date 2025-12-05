// lib/time-utils.ts

export const minutesToTop = (m: number, px: number) => Math.round(m * px);

export const labelForHour = (i: number) => {
  const h24 = i % 24;
  const h12 = ((h24 + 11) % 12) + 1;
  const ampm = h24 < 12 ? "AM" : "PM";
  return `${h12}:00 ${ampm}`;
};

export const formatTimeRange = (startIso: string, endIso: string, timezone: string) => {
  const start = new Date(new Date(startIso).toLocaleString("en-US", { timeZone: timezone }));
  const end = new Date(new Date(endIso).toLocaleString("en-US", { timeZone: timezone }));
  return `${start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}–${end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
};