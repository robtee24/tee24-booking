import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { adminRoutes } from "@/lib/admin/routes";
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
        actions={
          <Link
            href={adminRoutes.checkInAnalytics()}
            className="inline-flex h-10 items-center gap-1.5 rounded-apple-sm bg-apple-green px-4 text-apple-sm font-medium text-white hover:opacity-90"
          >
            <BarChart3 className="h-4 w-4" /> Analytics
          </Link>
        }
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
