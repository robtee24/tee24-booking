import { Card, CardHeader, PageHeader } from "@/components/ui";

export default async function KisiSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  await params;
  return (
    <div className="space-y-6">
      <PageHeader title="Kisi door access" description="Map Kisi door groups to membership plans. Door access auto-syncs with membership state." />

      <Card>
        <CardHeader title="Configured doors" subtitle="Doors visible to Kisi for this location." />
        <p className="mt-3 text-apple-sm text-apple-text-tertiary">
          Door-to-location mapping is currently driven by the <code className="rounded bg-apple-fill-secondary px-1.5 py-0.5 text-apple-xs">KISI_DOOR_TO_LOCATION_MAP</code> env var.
          Migrating to a UI-managed mapping is on the Phase 3 roadmap.
        </p>
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
