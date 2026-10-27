import { notFound } from "next/navigation";
import { getPrisma } from "@/lib/db";
import { PageHeader } from "@/components/ui/PageHeader";
import { listGuestViolations } from "@/services/bay-players.service";
import { BayAlertsClient } from "./BayAlertsClient";

export const dynamic = "force-dynamic";

/**
 * Guest-violation alerts raised by the bay kiosks: GSPro showed more players
 * than the booking allowed, the player acknowledged the charge and continued,
 * and the kiosk recorded the next two minutes of the bay screen.
 */
export default async function BayAlertsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ focus?: string }> }) {
  const { slug: raw } = await params;
  const { focus } = await searchParams;
  const slug = decodeURIComponent(raw);
  const location = await getPrisma().location.findUnique({ where: { slug }, select: { id: true, name: true, timezone: true } });
  if (!location) notFound();
  const items = await listGuestViolations(location.id).catch(() => []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bay Alerts"
        description={`Unauthorized-guest alerts from the ${location.name} bay kiosks. Each one records who was warned, when, and whether they accepted the per-guest charge or exited the game.`}
      />
      <BayAlertsClient slug={slug} timezone={location.timezone} initialItems={items} focusId={focus ?? null} />
    </div>
  );
}
