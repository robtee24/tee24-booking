import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getPrisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { getActorContext } from "@/lib/actor";
import { adminRoutes } from "@/lib/admin/routes";
import { CheckInAnalyticsClient } from "@/components/admin/check-ins/CheckInAnalyticsClient";

export const dynamic = "force-dynamic";

export default async function LocationCheckInAnalyticsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: raw } = await params;
  const slug = decodeURIComponent(raw);
  const [actor, location] = await Promise.all([
    getActorContext(),
    getPrisma().location.findUnique({ where: { slug }, select: { id: true, name: true, slug: true, timezone: true } }),
  ]);
  if (!location) notFound();
  if (!actor) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Check-in Analytics"
        description={`Usage patterns at ${location.name} — average check-ins per day, by weekday and time of day, top members, usage rate, and members who haven't checked in.`}
        actions={
          <Link
            href={adminRoutes.loc.checkIns(location.slug)}
            className="inline-flex h-10 items-center gap-1.5 rounded-apple-sm border border-apple-border bg-white px-4 text-apple-sm font-medium text-apple-text hover:bg-apple-fill-secondary"
          >
            <ArrowLeft className="h-4 w-4" /> Check Ins
          </Link>
        }
      />
      <CheckInAnalyticsClient
        scope={{ kind: "location", locationId: location.id, slug: location.slug, name: location.name, timezone: location.timezone }}
      />
    </div>
  );
}
