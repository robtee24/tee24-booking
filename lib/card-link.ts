// Short-lived signed links that let a signed-in app member add a card on file
// through the hosted web form at /pay/card/<token> (the app has no Square
// SDK). Token: `<memberId>.<exp>.<hmac(AUTH_SECRET, "<memberId>.<exp>")>`.
import { createHmac, timingSafeEqual } from "node:crypto";

export const CARD_LINK_TTL_S = 30 * 60;

function key() {
  const k = (process.env.AUTH_SECRET ?? process.env.ADMIN_JWT_SECRET ?? "").trim();
  if (!k) throw new Error("AUTH_SECRET is not set");
  return k;
}

function sig(msg: string) {
  return createHmac("sha256", key()).update(msg).digest("base64url");
}

export function mintCardLinkToken(memberId: string, ttlS = CARD_LINK_TTL_S) {
  const exp = Math.floor(Date.now() / 1000) + ttlS;
  return { token: `${memberId}.${exp}.${sig(`${memberId}.${exp}`)}`, expiresAt: new Date(exp * 1000) };
}

/** memberId when the token is valid and unexpired, otherwise null. */
export function verifyCardLinkToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [memberId, expS, s] = parts as [string, string, string];
  const exp = Number(expS);
  if (!memberId || !Number.isFinite(exp) || exp < Date.now() / 1000) return null;
  const expect = sig(`${memberId}.${exp}`);
  if (expect.length !== s.length || !timingSafeEqual(Buffer.from(expect), Buffer.from(s))) return null;
  return memberId;
}

export function cardLinkUrl(token: string) {
  const base = (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "https://reservations.tee24.golf").replace(/\/$/, "");
  return `${base}/pay/card/${encodeURIComponent(token)}`;
}
