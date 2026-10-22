import { getPrisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { MarketingSettingsClient } from "@/components/admin/marketing/MarketingSettingsClient";
import { getMarketingSettings } from "@/services/marketing.service";
import { getCommsSettings } from "@/lib/notify";
import { getQuoFromNumber } from "@/lib/quo";

export const dynamic = "force-dynamic";

export default async function MarketingSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug }, select: { id: true, organizationId: true } });
  if (!location) return null;

  const [settings, comms, groups] = await Promise.all([
    getMarketingSettings(location.organizationId),
    getCommsSettings(location.organizationId),
    prisma.automation.groupBy({ by: ["active"], _count: { _all: true }, where: { OR: [{ organizationId: location.organizationId }, { organizationId: null }] } }),
  ]);
  const automations = {
    active: groups.find((g) => g.active)?._count._all ?? 0,
    paused: groups.find((g) => !g.active)?._count._all ?? 0,
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Marketing settings" description="Automations master switch, referral rewards, acquisition sources, lead stages, and SMS compliance." />
      <MarketingSettingsClient
        initial={settings}
        automations={automations}
        smsFrom={getQuoFromNumber()}
        paypalConfigured={!!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET)}
        emailEnabled={comms.emailEnabled}
        smsEnabled={comms.smsEnabled}
      />
    </div>
  );
}
