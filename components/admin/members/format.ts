/**
 * Pure formatting helpers — no "use client" so server components can import them too.
 */
export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "—" : dt.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function fmtTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "—" : dt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function relTime(d: string | Date | null | undefined): string {
  if (!d) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 60) return `${days}d ago`;
  return fmtDate(d);
}

export function ageFromDob(dob: string | Date | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

export function toDateInput(d: string | Date | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

export function todayInput(): string {
  return toDateInput(new Date());
}

export function initials(first?: string | null, last?: string | null): string {
  return `${(first ?? "").trim()[0] ?? ""}${(last ?? "").trim()[0] ?? ""}`.toUpperCase() || "?";
}

export const ACQUISITION_SOURCES = ["Walk-in", "Google", "Instagram", "Facebook", "TikTok", "Referral", "Event", "Flyer", "Corporate", "Website", "Other"];
export const GENDERS = [
  { value: "", label: "Prefer not to say" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "nonbinary", label: "Non-binary" },
  { value: "other", label: "Other" },
];
/** Imported data stores "Male"/"Female"; map common spellings onto our option values. */
export function normalizeGender(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  const key = v.toLowerCase().replace(/[\s_-]/g, "");
  if (key === "m" || key === "male" || key === "man") return "male";
  if (key === "f" || key === "female" || key === "woman") return "female";
  if (key === "nonbinary" || key === "nb" || key === "enby") return "nonbinary";
  if (key === "other") return "other";
  if (key === "prefernottosay" || key === "unknown" || key === "n/a") return "";
  return v;
}

export function genderLabel(raw: string | null | undefined): string {
  const v = normalizeGender(raw);
  return GENDERS.find((g) => g.value === v)?.label ?? v;
}

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
