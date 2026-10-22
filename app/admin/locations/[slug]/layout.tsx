// app/admin/locations/[slug]/layout.tsx
import { notFound, redirect } from "next/navigation";
import { getPrisma } from "@/lib/db";
import { getCurrentAdmin, canAccessLocation } from "@/lib/access";
import { AdminLocationProvider } from "@/components/admin/LocationContext";
import { adminRoutes } from "@/lib/admin/routes";

export const dynamic = "force-dynamic";

/**
 * Validates the location slug and the admin's access to it *once* for every
 * page under /admin/locations/[slug]. Unknown slugs render the admin 404;
 * inaccessible locations bounce back to the location list.
 */
export default async function LocationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug: rawSlug } = await params;
  const slug = safeDecode(rawSlug);

  const admin = await getCurrentAdmin();
  if (!admin) redirect(adminRoutes.login());

  const location = await getPrisma().location.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true, timezone: true, disabled: true },
  });
  if (!location) notFound();

  const allowed = canAccessLocation(
    admin.role,
    admin.locations.map((l) => l.locationId),
    location.id
  );
  if (!allowed) redirect(adminRoutes.locations());

  return <AdminLocationProvider value={location}>{children}</AdminLocationProvider>;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
