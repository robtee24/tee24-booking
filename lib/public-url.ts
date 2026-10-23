/**
 * Base URLs for links we hand to people.
 *
 * - `memberBaseUrl()` — the member-facing site (signup/checkout, pay links,
 *   waiver signing, member portal). Set MEMBER_BASE_URL=https://clubhouse.tee24.golf
 *   to send members there; falls back to APP_BASE_URL (reservations.tee24.golf).
 * - Booking / admin links keep using APP_BASE_URL / NEXT_PUBLIC_BASE_URL.
 *
 * Both hostnames serve the same deployment, so a link that lands on the "wrong"
 * one still works — this only controls what we print and where we redirect.
 */
function clean(u: string | undefined | null): string | null {
  const v = (u ?? "").trim().replace(/\/+$/, "");
  return v ? v : null;
}

export function memberBaseUrl(): string {
  return clean(process.env.MEMBER_BASE_URL) || clean(process.env.APP_BASE_URL) || clean(process.env.NEXT_PUBLIC_BASE_URL) || "http://localhost:3000";
}

export function memberUrl(path: string): string {
  return `${memberBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Paths that belong to the member-facing site (used by middleware to redirect off the reservations host). */
export const MEMBER_PATH_PREFIXES = ["/signup", "/daypass", "/pay", "/sign", "/portal"] as const;
