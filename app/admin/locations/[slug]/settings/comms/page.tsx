import Link from "next/link";
import { Card, CardHeader, PageHeader } from "@/components/ui";

export default async function CommsSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <div className="space-y-6">
      <PageHeader title="Communications" description="Booking notifications and system emails for this location." />

      <Card>
        <CardHeader title="Booking notifications" subtitle="Confirmations, reminders, and change/cancel notices for bookings." />
        <p className="mt-3 text-apple-sm">
          <Link href={`/admin/locations/${slug}/notifications`} className="font-medium text-apple-blue hover:underline">
            Manage booking notifications →
          </Link>
        </p>
      </Card>

      <Card>
        <CardHeader title="Member system emails" subtitle="Welcome, payment receipts, payment failed, freeze, cancel, doc reminders." />
        <p className="mt-3 text-apple-sm text-apple-text-tertiary">
          System emails follow Tee24 design standards. Override per-template at the org level.
        </p>
      </Card>
    </div>
  );
}
