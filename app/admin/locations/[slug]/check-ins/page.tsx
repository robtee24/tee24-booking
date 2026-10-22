import { notFound } from "next/navigation";
import { getPrisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { getActorContext } from "@/lib/actor";
import { can } from "@/lib/permissions";
import { kisiConfigured } from "@/lib/kisi";
import { getKisiSyncState } from "@/services/door.service";
import { CheckInsClient } from "@/components/admin/check-ins/CheckInsClient";

export const dynamic = "force-dynamic";

export default async function LocationCheckInsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: raw } = await params;
  const slug = decodeURIComponent(raw);
  const [actor, location, sync] = await Promise.all([
    getActorContext(),
    getPrisma().location.findUnique({ where: { slug }, select: { id: true, name: true, slug: true, timezone: true } }),
    getKisiSyncState().catch(() => ({ lastRunAt: null })),
  ]);
  if (!location) notFound();
  if (!actor) return null;

  const doors = await getPrisma().door.count({ where: { locationId: location.id, hidden: false } });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Check Ins"
        description={`Door unlocks at ${location.name}, matched to members by Kisi email. ${
          doors ? `${doors} door${doors === 1 ? "" : "s"} assigned.` : "No doors assigned to this location yet — assign them under Door Access."
        }`}
      />
      <CheckInsClient
        scope={{ kind: "location", locationId: location.id, slug: location.slug, name: location.name, timezone: location.timezone }}
        kisiConfigured={kisiConfigured()}
        canManage={can(actor, "door.manage", { locationId: location.id })}
        lastSyncAt={sync.lastRunAt ? sync.lastRunAt.toISOString() : null}
      />
    </div>
  );
}
