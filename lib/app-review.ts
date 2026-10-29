// App Store / Play review demo login.
//
// Reviewers can't receive our SMS, so one designated member (APP_REVIEW_PHONE,
// E.164) signs in with a fixed 6-digit APP_REVIEW_CODE instead of a texted OTP.
// Both values live only in the hosting env — nothing here is a secret by itself,
// and when either is unset the bypass is disabled entirely.
import { timingSafeEqual } from "node:crypto";

function reviewPhone(): string | null {
  const v = (process.env.APP_REVIEW_PHONE ?? "").replace(/\D/g, "");
  if (v.length < 10) return null;
  return v.length === 10 ? `+1${v}` : `+${v}`;
}

export function isAppReviewPhone(e164: string): boolean {
  const p = reviewPhone();
  return !!p && !!process.env.APP_REVIEW_CODE && p === e164;
}

export function isAppReviewCode(e164: string, code: string): boolean {
  if (!isAppReviewPhone(e164)) return false;
  const expected = String(process.env.APP_REVIEW_CODE ?? "").trim();
  const given = String(code ?? "").trim();
  if (!/^\d{6}$/.test(expected) || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
