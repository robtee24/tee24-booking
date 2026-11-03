// lib/magic-link.ts
//
// Portal "sign-in link" tokens. One module so the member self-service flow and
// the admin "send access link" action mint identical tokens, and so the
// callback can enforce single use: every token carries a random `jti` which is
// recorded in ConsumedToken on first acceptance and rejected after that.
import { randomUUID } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db";
import { resolveJwtSecret } from "@/lib/jwt-secret";
import { memberBaseUrl } from "@/lib/public-url";

const ISSUER = "tee24-portal-magic";
const AUDIENCE = "tee24-portal-magic";
const PURPOSE = "portal-magic";
export const MAGIC_LINK_TTL_SECONDS = 15 * 60;

function secret() {
  return resolveJwtSecret(["MEMBER_JWT_SECRET", "ADMIN_JWT_SECRET"], "dev-secret-member");
}

export async function mintMagicToken(memberId: string): Promise<string> {
  return new SignJWT({ purpose: "magic" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(memberId)
    .setJti(randomUUID())
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${MAGIC_LINK_TTL_SECONDS}s`)
    .sign(secret());
}

export async function buildMagicLink(memberId: string): Promise<string> {
  const token = await mintMagicToken(memberId);
  return `${memberBaseUrl()}/api/portal/auth/magic/callback?token=${encodeURIComponent(token)}`;
}

/**
 * Verify a magic token and burn it. Returns the member id, or null if the token
 * is invalid, expired, or has already been used.
 */
export async function consumeMagicToken(token: string): Promise<string | null> {
  let sub: string;
  let jti: string | undefined;
  let exp: number | undefined;
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER, audience: AUDIENCE });
    if (!payload.sub) return null;
    sub = payload.sub;
    jti = payload.jti;
    exp = payload.exp;
  } catch {
    return null;
  }

  // Tokens minted before single-use enforcement have no jti; they expire
  // within 15 minutes of deploy, so simply refuse them rather than let an
  // un-trackable token through.
  if (!jti) return null;

  const expiresAt = exp ? new Date(exp * 1000) : new Date(Date.now() + MAGIC_LINK_TTL_SECONDS * 1000);
  try {
    await getPrisma().consumedToken.create({ data: { jti, purpose: PURPOSE, expiresAt } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null; // replay
    throw e;
  }

  // Opportunistic cleanup so the ledger stays small without a dedicated cron.
  void getPrisma().consumedToken.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 60_000) } } }).catch(() => undefined);

  return sub;
}
