import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { getActorContext } from "@/lib/actor";
import { adminRoutes } from "@/lib/admin/routes";
import { CheckInAnalyticsClient } from "@/components/admin/check-ins/CheckInAnalyticsClient";

export const dynamic = "force-dynamic";

export default async function CheckInAnalyticsPage() {
  const actor = await getActorContext();
  if (!actor) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Check-in Analytics"
        description="Usage patterns across all locations — average check-ins per day, by weekday and time of day, top members, usage rate, and members who haven't checked in."
        actions={
          <Link
            href={adminRoutes.checkIns()}
            className="inline-flex h-10 items-center gap-1.5 rounded-apple-sm border border-apple-border bg-white px-4 text-apple-sm font-medium text-apple-text hover:bg-apple-fill-secondary"
          >
            <ArrowLeft className="h-4 w-4" /> Check Ins
          </Link>
        }
      />
      <CheckInAnalyticsClient scope={{ kind: "org" }} />
    </div>
  );
}
