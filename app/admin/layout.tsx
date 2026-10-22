// app/admin/layout.tsx
import type { Metadata, Viewport } from "next";
import { getAdminSession } from "@/lib/session.server";
import { getPrisma } from "@/lib/db";
import { AdminShell, type ShellAdmin, type ShellLocation, type ShellMeta } from "@/components/admin/AdminShell";
import { getCommsStatus } from "@/services/location.service";
import { countUnreadNotifications } from "@/services/staff.service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Tee24 Admin", template: "%s · Tee24 Admin" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

/**
 * Admin shell layout (server component).
 *
 * Resolves the session + accessible locations once on the server so the sidebar
 * renders fully on first paint (no client fetch / layout shift). Auth redirects
 * are handled by middleware; when unauthenticated (login page) we render the
 * children without the chrome.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();

  let admin: ShellAdmin | null = null;
  let locations: ShellLocation[] = [];
  let meta: ShellMeta | undefined;

  if (session) {
    const prisma = getPrisma();
    const row = await prisma.admin.findUnique({
      where: { id: session.id },
      select: {
        id: true,
        name: true,
        phone: true,
        role: true,
        locations: { select: { location: { select: { id: true, name: true, slug: true, disabled: true } } } },
      },
    });

    if (row) {
      admin = { id: row.id, name: row.name, phone: row.phone, role: row.role };
      if (row.role === "ROOT" || row.role === "FULL") {
        locations = await prisma.location.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true, slug: true, disabled: true },
        });
      } else {
        locations = row.locations
          .map((l) => l.location)
          .sort((a, b) => a.name.localeCompare(b.name));
      }

      // Cheap extras for the shell: unread count (one indexed COUNT) and the
      // org comms switches (cached in-process for 30s).
      const [unreadCount, comms] = await Promise.all([
        countUnreadNotifications({ role: row.role, locationIds: locations.map((l) => l.id) }).catch(() => 0),
        getCommsStatus(),
      ]);
      meta = { unreadCount, comms };
    }
  }

  return (
    <AdminShell admin={admin} locations={locations} meta={meta}>
      {children}
    </AdminShell>
  );
}
