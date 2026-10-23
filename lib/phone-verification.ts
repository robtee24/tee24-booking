/**
 * Proof that a visitor verified a mobile number via SMS one-time code.
 *
 * After the OTP check passes we hand the browser a short-lived signed token
 * bound to the E.164 number. The signup endpoint demands that token and refuses
 * to create an account whose phone doesn't match it — so the number on file is
 * always one the member can actually receive codes on (it's their login).
 */
import { SignJWT, jwtVerify } from "jose";
import { toE164 } from "@/lib/phone";

const ISSUER = "tee24-phone-verification";
export const SIGNUP_PHONE_AUDIENCE = "signup";
export const PORTAL_LOGIN_AUDIENCE = "portal-login";
const TTL_SECONDS = 30 * 60;

function secret() {
  const s = process.env.MEMBER_JWT_SECRET || process.env.AUTH_SECRET || process.env.ADMIN_JWT_SECRET || "dev-secret-member";
  return new TextEncoder().encode(s);
}

export async function issuePhoneVerificationToken(rawPhone: string, audience: string): Promise<string> {
  const phone = toE164(rawPhone);
  return new SignJWT({ phone })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(phone)
    .setIssuer(ISSUER)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret());
}

/** Returns the verified E.164 phone, or null when the token is missing/invalid/expired or for another number. */
export async function verifyPhoneVerificationToken(token: string | null | undefined, rawPhone: string, audience: string): Promise<string | null> {
  if (!token) return null;
  let phone: string;
  try {
    phone = toE164(rawPhone);
  } catch {
    return null;
  }
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER, audience });
    return payload.sub === phone ? phone : null;
  } catch {
    return null;
  }
}
