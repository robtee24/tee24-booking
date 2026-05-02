import { Card, CardHeader, PageHeader } from "@/components/ui";

export default async function TaxSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  await params;
  return (
    <div className="space-y-6">
      <PageHeader title="Tax" description="Per-location sales tax configuration." />
      <Card>
        <CardHeader title="Sales tax" subtitle="Set the rate that applies to invoices issued at this location." />
        <p className="mt-3 text-apple-sm text-apple-text-tertiary">Tax is currently not collected at this location. Phase 2 adds full per-line-item tax math + reporting.</p>
      </Card>
    </div>
  );
}
