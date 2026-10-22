// lib/bay-app/admin-token.ts
import { SignJWT, jwtVerify } from "jose";
import { ENV } from "@/lib/env";
import { getPrisma } from "@/lib/db";

/**
 * Short-lived bearer token issued to the bay kiosk after an admin verifies a
 * Quo (SMS) one-time code. Lets the kiosk call admin-only bay-app endpoints
 * (register, bay-settings) without the browser cookie session.
 */
const AUDIENCE = "tee24-bay-app";
const ISSUER = "tee24-admin";
const TTL_SECONDS = 12 * 60 * 60;

function secret() {
  return new TextEncoder().encode(process.env.ADMIN_JWT_SECRET || ENV.AUTH_SECRET || "dev-secret");
}

export type BayAdmin = {
  id: string;
  name: string | null;
  phone: string;
  role: "ROOT" | "FULL" | "SCOPED";
  locationIds: string[];
};

export async function issueBayAdminToken(adminId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(adminId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret());
}

/** Resolve the admin from `Authorization: Bearer <token>`; null if missing/invalid. */
export async function getBayAdmin(req: Request): Promise<BayAdmin | null> {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER, audience: AUDIENCE });
    if (!payload.sub) return null;
    const admin = await getPrisma().admin.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, phone: true, role: true, locations: { select: { locationId: true } } },
    });
    if (!admin) return null;
    return {
      id: admin.id,
      name: admin.name,
      phone: admin.phone,
      role: admin.role,
      locationIds: admin.locations.map((l) => l.locationId),
    };
  } catch {
    return null;
  }
}

export function bayAdminCanAccess(admin: BayAdmin, locationId: string): boolean {
  return admin.role === "ROOT" || admin.role === "FULL" || admin.locationIds.includes(locationId);
}
