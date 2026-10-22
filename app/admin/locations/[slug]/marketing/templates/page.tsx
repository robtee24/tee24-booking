import Link from "next/link";
import { getPrisma } from "@/lib/db";
import { Button, PageHeader } from "@/components/ui";
import { Settings2 } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { listMarketingTemplates, MARKETING_MERGE_FIELDS } from "@/services/marketing.service";
import { SAMPLE_MEMBER_VARS } from "@/lib/system-templates";
import { TemplatesClient } from "@/components/admin/marketing/TemplatesClient";

export const dynamic = "force-dynamic";

export default async function TemplatesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const templates = await listMarketingTemplates(location.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Templates"
        description="Reusable email & SMS bodies for broadcasts and automation steps. System notifications (welcome, receipts, failed payments) live in Settings → Communications."
        actions={
          <Link href={adminRoutes.loc.settings.comms(slug)}>
            <Button variant="secondary" iconLeft={<Settings2 className="h-4 w-4" />}>System messages</Button>
          </Link>
        }
      />
      <TemplatesClient
        initial={templates.map((t) => ({ id: t.id, name: t.name, channel: t.channel, category: t.category, subject: t.subject, body: t.body, active: t.active, organizationId: t.organizationId, updatedAt: t.updatedAt.toISOString() }))}
        mergeFields={MARKETING_MERGE_FIELDS}
        sample={SAMPLE_MEMBER_VARS as Record<string, string>}
      />
    </div>
  );
}
