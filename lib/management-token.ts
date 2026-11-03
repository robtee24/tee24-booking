// lib/management-token.ts
// Guest bookings are managed with the capability token from the confirmation
// link. Compare it in constant time so it can't be guessed byte by byte.
import { timingSafeEqual } from "crypto";

export function managementTokenMatches(
  expected: string | null | undefined,
  supplied: string | null | undefined,
): boolean {
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}
