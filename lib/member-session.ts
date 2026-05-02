/**
 * Member portal session — separate cookie + secret from admin sessions.
 *
 * Cookie: tee24_member
 * Payload: { sub: memberId, role: "MEMBER" | "IMPERSONATED", impersonatedBy?: adminId }
 *
 * Admin "View as Member" stamps `impersonatedBy` so we can:
 *   - Show a kill-switch banner in the portal
 *   - Audit-log every page/action under the impersonation
 *   - Disable destructive actions while impersonated
 */
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { getPrisma } from "@/lib/db";

const COOKIE_NAME = "tee24_member";
const MAX_AGE = Number(process.env.MEMBER_SESSION_MAX_AGE) || 60 * 60 * 24 * 30; // 30 days
const ISSUER = "tee24-portal";
const AUDIENCE = "tee24-portal";

export type MemberSession = {
  sub: string;            // member id
  role: "MEMBER" | "IMPERSONATED";
  impersonatedBy?: string; // admin id
  impersonatedAt?: number; // unix seconds
};

function getSecret() {
  const s = process.env.MEMBER_JWT_SECRET || process.env.ADMIN_JWT_SECRET || "dev-secret-member";
  return new TextEncoder().encode(s);
}

export async function setMemberSession(memberId: string, opts?: { impersonatedBy?: string }) {
  const role = opts?.impersonatedBy ? "IMPERSONATED" : "MEMBER";
  const token = await new SignJWT({
    role,
    impersonatedBy: opts?.impersonatedBy,
    impersonatedAt: opts?.impersonatedBy ? Math.floor(Date.now() / 1000) : undefined,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(memberId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(getSecret());

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearMemberSession() {
  const jar = await cookies();
  jar.set(COOKIE_NAME, "", { path: "/", maxAge: 0, expires: new Date(0) });
}

export async function getMemberSession(): Promise<MemberSession | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), { issuer: ISSUER, audience: AUDIENCE });
    if (!payload.sub) return null;
    return {
      sub: payload.sub as string,
      role: (payload.role as "MEMBER" | "IMPERSONATED") ?? "MEMBER",
      impersonatedBy: payload.impersonatedBy as string | undefined,
      impersonatedAt: payload.impersonatedAt as number | undefined,
    };
  } catch {
    return null;
  }
}

export async function getCurrentMember() {
  const sess = await getMemberSession();
  if (!sess) return null;
  return getPrisma().member.findUnique({
    where: { id: sess.sub },
    include: {
      location: { select: { id: true, name: true, slug: true } },
      memberTags: { include: { tag: true } },
    },
  });
}
