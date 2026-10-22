import { PageHeader } from "@/components/ui";
import { getActorContext } from "@/lib/actor";
import { can } from "@/lib/permissions";
import { kisiConfigured } from "@/lib/kisi";
import { getKisiSyncState } from "@/services/door.service";
import { CheckInsClient } from "@/components/admin/check-ins/CheckInsClient";

export const dynamic = "force-dynamic";

export default async function CheckInsOverviewPage() {
  const actor = await getActorContext();
  if (!actor) return null;
  const sync = await getKisiSyncState().catch(() => ({ lastRunAt: null }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Check Ins"
        description="Every Kisi door unlock, matched to a member by email. Totals across all locations, with the exact unlock time and door for each visit."
      />
      <CheckInsClient
        scope={{ kind: "org" }}
        kisiConfigured={kisiConfigured()}
        canManage={can(actor, "door.manage")}
        lastSyncAt={sync.lastRunAt ? sync.lastRunAt.toISOString() : null}
      />
    </div>
  );
}
