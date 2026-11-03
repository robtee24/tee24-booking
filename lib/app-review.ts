// App Store / Play review demo login.
//
// Reviewers can't receive our SMS, so the review member signs in with no code:
// the app calls /auth/start, sees `review: true`, and goes straight to
// /auth/verify without one (older builds that still show the code screen get
// through with any 6 digits). The review number is the fictional 555-555-5555
// (never assignable in North America) plus, optionally, APP_REVIEW_PHONE from
// the hosting env. The member on that number is a demo account with no real
// member data behind it.

const REVIEW_PHONES = new Set(["+15555555555"]);

function envReviewPhone(): string | null {
  const v = (process.env.APP_REVIEW_PHONE ?? "").replace(/\D/g, "");
  if (v.length < 10) return null;
  return v.length === 10 ? `+1${v}` : `+${v}`;
}

export function isAppReviewPhone(e164: string): boolean {
  return REVIEW_PHONES.has(e164) || envReviewPhone() === e164;
}
