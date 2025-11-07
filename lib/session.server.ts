// lib/session.server.ts
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { ENV } from "@/lib/env";
import { getPrisma } from "@/lib/db";

export type AdminSession = {
  sub: string;
  role: "ROOT" | "FULL" | "SCOPED";
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

  const jar = await cookies(); // response cookies

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

export async function getAdminSession(): Promise<(AdminSession & { id: string }) | null> {
  const jar = await cookies();
  const primary = jar.get(COOKIE_PRIMARY)?.value;
  const legacy = jar.get(COOKIE_LEGACY)?.value;
  const token = primary || legacy;

  console.log("[getAdminSession] primary:", !!primary);
  console.log("[getAdminSession] legacy:", !!legacy);
  console.log("[getAdminSession] token exists:", !!token);

  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    console.log("[getAdminSession] JWT payload:", payload);

    const id = payload.sub as string;
    if (!id) {
      console.log("[getAdminSession] no sub in JWT");
      return null;
    }

    const admin = await getPrisma().admin.findUnique({
      where: { id },
      select: { id: true, role: true },
    });

    console.log("[getAdminSession] DB admin:", admin);

    if (!admin) {
      console.log("[getAdminSession] admin not found in DB");
      return null;
    }

    if (payload.role && payload.role !== admin.role) {
      console.log("[getAdminSession] role mismatch:", payload.role, admin.role);
      return null;
    }

    return { sub: id, id, role: admin.role };
  } catch (err: any) {
    console.error("[getAdminSession] JWT verify failed:", err.message);
    return null;
  }
}

export const isRoot = (s: any): s is { role: "ROOT" } => !!s && s.role === "ROOT";
export const hasFullAccess = (s: any): s is { role: "ROOT" | "FULL" } =>
  !!s && (s.role === "ROOT" || s.role === "FULL");