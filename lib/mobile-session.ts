/**
 * Member mobile-app sessions.
 *
 * - Bearer JWT (HS256) valid for 90 days, carrying member id, device row id and
 *   a session id. The session row (MobileSession) lets us revoke server-side:
 *   admin "unlock device", approved transfer, member sign-out.
 * - Every request re-checks that the session is unrevoked and the device is
 *   still the member's active device, so a transferred/unlocked phone is cut
 *   off immediately rather than at token expiry.
 */
import { createHash, randomBytes } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";

const ISSUER = "tee24-mobile";
const AUDIENCE = "tee24-mobile";
/** 3 months */
export const MOBILE_SESSION_SECONDS = Number(process.env.MOBILE_SESSION_MAX_AGE) || 60 * 60 * 24 * 90;

function secret() {
  const s = process.env.MOBILE_JWT_SECRET || process.env.MEMBER_JWT_SECRET || process.env.ADMIN_JWT_SECRET || "dev-secret-member";
  return new TextEncoder().encode(s);
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export type MobileClaims = {
  sub: string; // member id
  did: string; // MemberDevice.id
  sid: string; // MobileSession.id
};

export async function issueMobileSession(input: { memberId: string; deviceRowId: string; ip?: string | null }) {
  const prisma = getPrisma();
  const nonce = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + MOBILE_SESSION_SECONDS * 1000);
  const session = await prisma.mobileSession.create({
    data: {
      memberId: input.memberId,
      deviceId: input.deviceRowId,
      tokenHash: hashToken(nonce),
      expiresAt,
      ipAddress: input.ip ?? null,
      lastUsedAt: new Date(),
    },
  });
  const token = await new SignJWT({ did: input.deviceRowId, sid: session.id, n: nonce })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.memberId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${MOBILE_SESSION_SECONDS}s`)
    .sign(secret());
  return { token, expiresAt, sessionId: session.id };
}

export class MobileAuthError extends Error {
  constructor(message: string, public status = 401, public code = "UNAUTHORIZED") {
    super(message);
    this.name = "MobileAuthError";
  }
}

function bearer(req: NextRequest): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

export type MobileAuth = {
  memberId: string;
  deviceRowId: string;
  sessionId: string;
  member: NonNullable<Awaited<ReturnType<typeof loadMember>>>;
};

async function loadMember(memberId: string) {
  return getPrisma().member.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      organizationId: true,
      locationId: true,
      homeLocationId: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      status: true,
      photoUrl: true,
      kisiAccessEnabled: true,
      kisiAccessReason: true,
      kisiUserId: true,
      joinDate: true,
      membershipStartDate: true,
      mergedIntoId: true,
      location: { select: { id: true, name: true, slug: true, timezone: true } },
    },
  });
}

/**
 * Resolve and validate the mobile session on a request. Throws MobileAuthError.
 * Touches lastSeen on the device/session (throttled to once a minute).
 */
export async function requireMobileAuth(req: NextRequest): Promise<MobileAuth> {
  const token = bearer(req);
  if (!token) throw new MobileAuthError("Sign in required");
  let claims: MobileClaims & { n?: string };
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER, audience: AUDIENCE });
    if (!payload.sub || typeof payload.did !== "string" || typeof payload.sid !== "string" || typeof payload.n !== "string") throw new Error("bad claims");
    claims = { sub: payload.sub, did: payload.did, sid: payload.sid, n: payload.n };
  } catch {
    throw new MobileAuthError("Your session has expired. Please sign in again.", 401, "SESSION_EXPIRED");
  }

  const prisma = getPrisma();
  const session = await prisma.mobileSession.findUnique({
    where: { id: claims.sid },
    include: { device: { select: { id: true, memberId: true, revokedAt: true, revokedReason: true, lastSeenAt: true } } },
  });
  if (!session || session.tokenHash !== hashToken(claims.n!) || session.memberId !== claims.sub) {
    throw new MobileAuthError("Your session is no longer valid. Please sign in again.", 401, "SESSION_INVALID");
  }
  if (session.revokedAt) throw new MobileAuthError("You were signed out of this device.", 401, "SESSION_REVOKED");
  if (session.expiresAt < new Date()) throw new MobileAuthError("Your session has expired. Please sign in again.", 401, "SESSION_EXPIRED");
  if (session.device.revokedAt) {
    const why = session.device.revokedReason === "transfer_approved" ? "Your account was moved to a new phone." : "This device was unlinked from your account.";
    throw new MobileAuthError(`${why} Sign in again to continue.`, 401, "DEVICE_REVOKED");
  }

  const member = await loadMember(claims.sub);
  if (!member || member.mergedIntoId) throw new MobileAuthError("Account not found", 401, "MEMBER_NOT_FOUND");

  // Throttled last-seen bookkeeping
  const now = Date.now();
  const last = session.lastUsedAt?.getTime() ?? 0;
  if (now - last > 60_000) {
    await Promise.all([
      prisma.mobileSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } }),
      prisma.memberDevice.update({ where: { id: session.device.id }, data: { lastSeenAt: new Date() } }),
    ]).catch(() => {});
  }

  return { memberId: member.id, deviceRowId: session.device.id, sessionId: session.id, member };
}

/** Revoke all live sessions for a device row. */
export async function revokeDeviceSessions(deviceRowId: string) {
  await getPrisma().mobileSession.updateMany({ where: { deviceId: deviceRowId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeSession(sessionId: string) {
  await getPrisma().mobileSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}
