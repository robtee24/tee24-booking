import { Card, CardHeader, PageHeader } from "@/components/ui";

export default async function BillingSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  await params;
  return (
    <div className="space-y-6">
      <PageHeader title="Billing settings" description="Dunning, late fees, freeze policy, taxes, and Square integration." />

      <Card>
        <CardHeader title="Square integration" subtitle="Required to charge cards on file and process refunds." />
        <div className="mt-4 text-apple-sm text-apple-text-secondary">
          Configure Square credentials in <code className="rounded bg-apple-fill-secondary px-1.5 py-0.5 text-apple-xs">/admin/settings#square</code>.
        </div>
      </Card>

      <Card>
        <CardHeader title="Dunning policy" subtitle="What happens when a payment fails." />
        <ul className="mt-4 list-disc space-y-1 pl-6 text-apple-sm text-apple-text-secondary">
          <li>Retry schedule: 1 day, 3 days, 7 days after failure</li>
          <li>Email member after each failed attempt</li>
          <li>SMS reminder at attempt 2 (transactional, opt-out compliant)</li>
          <li>Grace period before disabling Kisi access: 7 days</li>
        </ul>
      </Card>

      <Card>
        <CardHeader title="Late fees" subtitle="Apply a fee to invoices not paid within X days past due." />
        <p className="mt-3 text-apple-sm text-apple-text-tertiary">Configurable per organization. Default: disabled.</p>
      </Card>

      <Card>
        <CardHeader title="Tax" subtitle="Per-location sales tax rates." />
        <p className="mt-3 text-apple-sm text-apple-text-tertiary">Tax handling not yet enabled at this location.</p>
      </Card>
    </div>
  );
}
