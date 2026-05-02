import { Card, CardHeader, PageHeader } from "@/components/ui";

export default async function MarketingSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  await params;
  return (
    <div className="space-y-6">
      <PageHeader title="Marketing settings" description="Sender identities, opt-in defaults, attribution windows." />

      <Card>
        <CardHeader title="Email sender" subtitle="Default From address for marketing emails." />
        <p className="mt-3 text-apple-sm text-apple-text-tertiary">Configured at organization level. See <code className="rounded bg-apple-fill-secondary px-1.5 py-0.5">/admin/settings#resend</code>.</p>
      </Card>

      <Card>
        <CardHeader title="SMS sender (Quo)" />
        <p className="mt-3 text-apple-sm text-apple-text-tertiary">Phone number, opt-in language, and brand keyword.</p>
      </Card>

      <Card>
        <CardHeader title="Attribution" subtitle="UTM capture, attribution window, traffic sources." />
        <p className="mt-3 text-apple-sm text-apple-text-tertiary">Default attribution window: 30 days from first touch.</p>
      </Card>
    </div>
  );
}
