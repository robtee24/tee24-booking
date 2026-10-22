// lib/session.server.ts
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { ENV } from "@/lib/env";
import { getPrisma } from "@/lib/db";

export type AdminSession = {
  sub: string;
  id: string;
  role: "ROOT" | "FULL" | "SCOPED";
  locationSlugs?: string[];
};

const COOKIE_PRIMARY = "admin_jwt";
const COOKIE_LEGACY = "ADMIN_SESSION";
const COOKIE_MAX_AGE = Number(ENV.SESSION_MAX_AGE) || 60 * 60 * 24 * 7;
const JWT_ISSUER = "tee24-admin";
const JWT_AUDIENCE = "tee24-admin";

function getSecret() {
  const secretStr = process.env.ADMIN_JWT_SECRET || ENV.AUTH_SECRET || "dev-secret";
  if (secretStr === "dev-secret" && process.env.NODE_ENV !== "test") {
    console.warn("Using insecure dev-secret for admin JWT. Set ADMIN_JWT_SECRET.");
  }
  return new TextEncoder().encode(secretStr);
}

export async function setAdminSession(adminId: string, role: AdminSession["role"]) {
  const token = await new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(adminId)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${COOKIE_MAX_AGE}s`)
    .sign(getSecret());

  const jar = await cookies();
  const opts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  };
  jar.set(COOKIE_PRIMARY, token, opts);
  jar.set(COOKIE_LEGACY, token, opts);
}

export async function clearAdminSession() {
  console.log("clearAdminSession: clearing cookies via Set-Cookie");
  const jar = await cookies();
  const deleteCookie = (name: string, path: string) => {
    jar.set({
      name,
      value: "",
      path,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 0,
      expires: new Date(0),
    });
  };
  const paths = ["/", "/admin"];
  for (const path of paths) {
    deleteCookie(COOKIE_PRIMARY, path);
    deleteCookie(COOKIE_LEGACY, path);
  }
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const jar = await cookies();
  const primary = jar.get(COOKIE_PRIMARY)?.value;
  const legacy = jar.get(COOKIE_LEGACY)?.value;
  const token = primary || legacy;

  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    const id = payload.sub as string;
    if (!id) return null;

    // Fetch admin role from DB
    const admin = await getPrisma().admin.findUnique({
      where: { id },
      select: { id: true, role: true },
    });

    if (!admin) return null;
    if (payload.role && payload.role !== admin.role) return null;

    const session: AdminSession = { sub: id, id, role: admin.role };

    // Only fetch location slugs for SCOPED admins
    if (admin.role === "SCOPED") {
      const links = await getPrisma().adminLocation.findMany({
        where: { adminId: id },
        select: {
          location: { select: { slug: true } },
        },
      });
      session.locationSlugs = links.map((l) => l.location.slug);
    }

    return session;
  } catch (err: any) {
    console.error("[getAdminSession] JWT verify failed:", err.message);
    return null;
  }
}

/* ───────────────────────── 2FA pending state ──────────────────────────────
 * After a successful OTP for an admin with `twoFactorEnabled`, we do NOT issue
 * the full session. Instead a short-lived (5 min) JWT in a separate cookie
 * records "OTP passed for admin X". Only `/api/admin/auth/2fa/login-verify`
 * (or `/api/admin/auth/verify` with `{ totp }`) consumes it and, on a valid
 * TOTP code, calls `setAdminSession` and clears the pending cookie.
 * Middleware never treats this cookie as a session because `getAdminSession`
 * ignores it.
 */
const COOKIE_2FA_PENDING = "admin_2fa_pending";
const PENDING_2FA_MAX_AGE = 5 * 60; // seconds
const PENDING_2FA_AUDIENCE = "tee24-admin-2fa-pending";

export async function setPending2faSession(adminId: string) {
  const token = await new SignJWT({ stage: "otp-ok" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(adminId)
    .setIssuer(JWT_ISSUER)
    .setAudience(PENDING_2FA_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${PENDING_2FA_MAX_AGE}s`)
    .sign(getSecret());
  const jar = await cookies();
  jar.set(COOKIE_2FA_PENDING, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PENDING_2FA_MAX_AGE,
  });
}

export async function getPending2faSession(): Promise<{ adminId: string } | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_2FA_PENDING)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: JWT_ISSUER,
      audience: PENDING_2FA_AUDIENCE,
    });
    if (!payload.sub) return null;
    return { adminId: payload.sub };
  } catch {
    return null;
  }
}

export async function clearPending2faSession() {
  const jar = await cookies();
  jar.set({
    name: COOKIE_2FA_PENDING,
    value: "",
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    expires: new Date(0),
  });
}

export const isRoot = (s: any): s is { role: "ROOT" } => !!s && s.role === "ROOT";
export const hasFullAccess = (s: any): s is { role: "ROOT" | "FULL" } =>
  !!s && (s.role === "ROOT" || s.role === "FULL");