// app/admin/settings/email/page.tsx — organization identity + email/SMS controls
import Link from "next/link";
import { getCurrentAdmin, isFullAccess } from "@/lib/access";
import { adminRoutes } from "@/lib/admin/routes";
import { Card, PageHeader } from "@/components/ui";
import { getOrCreateOrg } from "@/services/location.service";
import { OrgSettingsForm } from "./OrgSettingsForm";

export const dynamic = "force-dynamic";

export default async function OrgEmailSettingsPage() {
  const me = await getCurrentAdmin();
  if (!me) return null;
  if (!isFullAccess(me.role)) {
    return (
      <div className="space-y-6">
        <PageHeader title="Organization, email & SMS" />
        <Card>
          <p className="text-apple-sm text-apple-text-secondary">Only ROOT or FULL admins can change organization settings.</p>
          <Link href={adminRoutes.settings()} className="mt-3 inline-block text-apple-sm font-medium text-apple-blue hover:underline">← Back to settings</Link>
        </Card>
      </div>
    );
  }

  const org = await getOrCreateOrg();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization, email & SMS"
        description="Brand identity used across emails and the member portal, plus the global switches that stop all outbound email or SMS."
        meta={<span className="text-apple-xs text-apple-text-tertiary">Updated {new Date(org.updatedAt).toLocaleString()}</span>}
      />
      <OrgSettingsForm org={{ ...org, updatedAt: org.updatedAt.toISOString() }} />
    </div>
  );
}
