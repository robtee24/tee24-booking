// lib/access.ts
import { prisma } from "@/lib/db";
import { getAdminSession } from "@/lib/session";
import type { AdminRole } from "@prisma/client";

/** Get the current admin row (or null) based on the ADMIN_SESSION cookie */
export async function getCurrentAdmin() {
  const session = await getAdminSession();
  if (!session?.sub) return null;

  return prisma.admin.findUnique({
    where: { id: session.sub },
    select: {
      id: true,
      phone: true,
      name: true,
      role: true,
      locations: {
        select: {
          locationId: true,
          location: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  });
}

/** ROOT and FULL are “full access”; SCOPED is limited to assigned locations */
export function isFullAccess(role: AdminRole | null | undefined) {
  return role === "ROOT" || role === "FULL";
}

/** Can this admin manage this location? */
export function canAccessLocation(
  role: AdminRole | null | undefined,
  adminLocationIds: string[],
  locationId: string
) {
  if (isFullAccess(role)) return true;
  return adminLocationIds.includes(locationId);
}

/** Fetch only locations visible to the current admin */
export async function getAccessibleLocations() {
  const admin = await getCurrentAdmin();
  if (!admin) return [];

  if (isFullAccess(admin.role)) {
    // Full access sees everything
    const all = await prisma.location.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true },
    });
    return all;
  }

  // Scoped: only assigned
  return admin.locations.map((al) => al.location);
}

/** Throws if current admin cannot access given locationId */
export async function assertCanManageLocation(locationId: string) {
  const admin = await getCurrentAdmin();
  if (!admin) throw new Error("Not authenticated");

  if (isFullAccess(admin.role)) return;

  const allowed = admin.locations.some((l) => l.locationId === locationId);
  if (!allowed) throw new Error("Forbidden");
}

/** Utility for UI: get a flat list of locationIds this admin can access */
export async function getAccessibleLocationIds(): Promise<string[]> {
  const admin = await getCurrentAdmin();
  if (!admin) return [];
  if (isFullAccess(admin.role)) {
    const all = await prisma.location.findMany({ select: { id: true } });
    return all.map((l) => l.id);
  }
  return admin.locations.map((al) => al.locationId);
}
