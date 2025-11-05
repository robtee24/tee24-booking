// lib/session.ts
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { ENV } from "@/lib/env";
import { prisma } from "@/lib/db";

type AdminSession = {
  sub: string;        // admin id
  role: "ROOT" | "FULL" | "SCOPED";
};

// Keep supporting old + new names
const COOKIE_PRIMARY = "admin_jwt";     // what auth/verify sets now
const COOKIE_LEGACY  = "ADMIN_SESSION"; // older name some code reads
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function getSecret() {
  // match auth/verify: ADMIN_JWT_SECRET || AUTH_SECRET || "dev-secret"
  const secretStr = process.env.ADMIN_JWT_SECRET || ENV.AUTH_SECRET || "dev-secret";
  return new TextEncoder().encode(secretStr);
}

/**
 * Write BOTH cookies for compatibility.
 */
export async function setAdminSession(adminId: string, role: AdminSession["role"]) {
  const token = await new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(adminId)
    .setIssuedAt()
    .setExpirationTime(`${COOKIE_MAX_AGE}s`)
    .sign(getSecret());

  const jar = await cookies();

  const cookieOpts = {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  };

  // Primary cookie used by middleware/auth
  jar.set(COOKIE_PRIMARY, token, cookieOpts);
  // Legacy cookie used by older readers
  jar.set(COOKIE_LEGACY,  token, cookieOpts);
}

export async function clearAdminSession() {
  const jar = await cookies();
  jar.delete(COOKIE_PRIMARY);
  jar.delete(COOKIE_LEGACY);
}

/**
 * Read/verify either cookie and ensure the admin still exists.
 */
export async function getAdminSession(): Promise<(AdminSession & { id: string }) | null> {
  const jar = await cookies();
  const token =
    jar.get(COOKIE_PRIMARY)?.value ||
    jar.get(COOKIE_LEGACY)?.value;

  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecret());
    const id = (payload.sub || "") as string;

    // Ensure admin still exists and get current role from DB
    const admin = await prisma.admin.findUnique({
      where: { id },
      select: { id: true, role: true },
    });
    if (!admin) return null;

    return { sub: id, id, role: admin.role as AdminSession["role"] };
  } catch {
    return null;
  }
}

export function isRoot(s: { role: AdminSession["role"] } | null) {
  return !!s && s.role === "ROOT";
}

export function hasFullAccess(s: { role: AdminSession["role"] } | null) {
  return !!s && (s.role === "ROOT" || s.role === "FULL");
}


