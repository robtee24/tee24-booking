import Link from "next/link";
import { getPrisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { adminRoutes } from "@/lib/admin/routes";
import { billingSettingsOf } from "@/services/billing.service";
import { getActorContext } from "@/lib/actor";
import { can } from "@/lib/permissions";
import { SquareConnectForm } from "@/components/admin/billing/SquareConnectForm";
import { BillingSettingsForm, TaxSettingsSection } from "@/components/admin/billing/BillingSettingsForm";
import { squareStatusPayload } from "@/app/api/admin/billing/_shared";

export const dynamic = "force-dynamic";

export default async function BillingSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const actor = await getActorContext().catch(() => null);
  const canEdit = actor ? can(actor, "billing.configure", { locationId: location.id }) : false;
  const settings = billingSettingsOf(location);
  const square = await squareStatusPayload(location.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing settings"
        description="This location's Square account, dunning policy, late fees, card surcharge, and sales tax."
        actions={<Link href={adminRoutes.loc.settings.tax(slug)} className="text-apple-sm text-apple-blue hover:underline">Tax settings →</Link>}
      />

      <SquareConnectForm slug={slug} status={square} canEdit={canEdit} />

      <section className="rounded-apple border border-apple-divider bg-white p-4 shadow-apple sm:p-5">
        <h2 className="text-apple-lg font-semibold text-apple-text">Automated jobs</h2>
        <p className="mt-0.5 text-apple-sm text-apple-text-secondary">Scheduled via Vercel Cron against <code className="rounded bg-apple-fill-secondary px-1 py-0.5 font-mono text-apple-xs">/api/cron</code>.</p>
        <ul className="mt-3 divide-y divide-apple-divider text-apple-sm">
          <li className="flex items-center justify-between py-2"><span className="text-apple-text">Generate recurring invoices &amp; charge cards</span><span className="font-mono text-apple-xs text-apple-text-tertiary">generate-invoices · daily 09:00 UTC</span></li>
          <li className="flex items-center justify-between py-2"><span className="text-apple-text">Retry failed payments (dunning)</span><span className="font-mono text-apple-xs text-apple-text-tertiary">retry-failed-payments · hourly</span></li>
          <li className="flex items-center justify-between py-2"><span className="text-apple-text">Upcoming payment &amp; card-expiry reminders</span><span className="font-mono text-apple-xs text-apple-text-tertiary">upcoming-payment-reminders · daily 09:30 UTC</span></li>
        </ul>
      </section>

      <BillingSettingsForm slug={slug} settings={settings} canEdit={canEdit} />
      <TaxSettingsSection slug={slug} settings={settings} canEdit={canEdit} />
    </div>
  );
}
