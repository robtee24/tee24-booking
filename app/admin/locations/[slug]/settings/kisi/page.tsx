import Link from "next/link";
import { notFound } from "next/navigation";
import { getPrisma } from "@/lib/db";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { adminRoutes } from "@/lib/admin/routes";
import { kisiConfigured } from "@/lib/kisi";

export const dynamic = "force-dynamic";

export default async function KisiSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: raw } = await params;
  const slug = decodeURIComponent(raw);
  const location = await getPrisma().location.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!location) notFound();

  const doors = await getPrisma().door.findMany({
    where: { locationId: location.id },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, kisiLockId: true, kisiPlaceName: true, online: true, lockedDown: true, hidden: true, lastUnlockAt: true },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kisi door access"
        description="Doors assigned to this location. Unlocks on these doors are tracked as check-ins."
        actions={
          <Link href={adminRoutes.doorAccess()} className="text-apple-sm font-medium text-apple-blue hover:underline">
            Manage in Door Access →
          </Link>
        }
      />

      <Card>
        <CardHeader
          title="Assigned doors"
          subtitle={
            kisiConfigured()
              ? `${doors.length} door${doors.length === 1 ? "" : "s"} assigned to ${location.name}.`
              : "Kisi isn't connected yet — add KISI_API_KEY, then assign doors under Door Access."
          }
        />
        {doors.length > 0 ? (
          <ul className="mt-3 divide-y divide-apple-divider">
            {doors.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2.5 text-apple-sm">
                <div className="min-w-0">
                  <div className="font-medium text-apple-text">{d.name}</div>
                  <div className="text-apple-xs text-apple-text-tertiary">
                    {d.kisiPlaceName ? `${d.kisiPlaceName} · ` : ""}Kisi lock #{d.kisiLockId}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {d.online === true && <Badge tone="success" size="sm">Online</Badge>}
                  {d.online === false && <Badge tone="danger" size="sm">Offline</Badge>}
                  {d.lockedDown && <Badge tone="danger" size="sm">Locked down</Badge>}
                  {d.hidden && <Badge tone="muted" size="sm">Hidden</Badge>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-apple-sm text-apple-text-tertiary">
            No doors assigned. Open <Link href={adminRoutes.doorAccess()} className="text-apple-blue hover:underline">Door Access</Link>, sync from
            Kisi, and pick this location for each door.
          </p>
        )}
      </Card>

      <Card>
        <CardHeader title="Auto-sync rules" subtitle="When a member's access changes." />
        <ul className="mt-3 list-disc space-y-1 pl-6 text-apple-sm text-apple-text-secondary">
          <li><strong>Enable:</strong> on signup success, payment recovery, unfreeze, reactivation, doc signed.</li>
          <li><strong>Disable:</strong> on payment failed past grace, freeze start, doc expired, membership cancelled, chargeback.</li>
          <li>All transitions are audit-logged. Manual overrides require <code>kisi.override</code> permission.</li>
        </ul>
      </Card>
    </div>
  );
}
