import { PageHeader } from "@/components/ui";
import { getPrisma } from "@/lib/db";
import { getAccessibleLocations, isFullAccess } from "@/lib/access";
import { getActorContext } from "@/lib/actor";
import { can } from "@/lib/permissions";
import { kisiConfigured } from "@/lib/kisi";
import { listDoors, refreshDoorStatuses } from "@/services/door.service";
import { DoorAccessClient, type DoorRow } from "@/components/admin/door-access/DoorAccessClient";

export const dynamic = "force-dynamic";

export default async function DoorAccessPage() {
  const actor = await getActorContext();
  if (!actor) return null;
  const full = isFullAccess(actor.role);

  // Pull live status on page load when Kisi is configured (one list call).
  const configured = kisiConfigured();
  if (configured) await refreshDoorStatuses();

  const [doors, locations] = await Promise.all([listDoors({ includeHidden: full }), getAccessibleLocations()]);
  const visible = full ? doors : doors.filter((d) => d.locationId && (actor.locationIds ?? []).includes(d.locationId));

  const rows: DoorRow[] = visible.map((d) => ({
    ...d,
    lastStatusAt: d.lastStatusAt ? d.lastStatusAt.toISOString() : null,
    lastUnlockAt: d.lastUnlockAt ? d.lastUnlockAt.toISOString() : null,
  }));

  const unassigned = await getPrisma().door.count({ where: { locationId: null, hidden: false } });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Door Access"
        description="Live status of every Kisi door, remote unlock, and which Tee24 location each door belongs to (this drives check-in tracking)."
        meta={
          !configured ? undefined : unassigned > 0 && full ? (
            <span className="text-apple-sm text-apple-orange">
              {unassigned} door{unassigned === 1 ? "" : "s"} not assigned to a location — unlocks there won't count as check-ins until assigned.
            </span>
          ) : undefined
        }
      />
      <DoorAccessClient
        initialDoors={rows}
        locations={locations}
        kisiConfigured={configured}
        canManage={can(actor, "door.manage")}
        canUnlockAny={can(actor, "door.unlock")}
      />
    </div>
  );
}
