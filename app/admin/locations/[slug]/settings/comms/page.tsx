import Link from "next/link";
import { getPrisma } from "@/lib/db";
import { getCurrentAdmin } from "@/lib/access";
import { adminRoutes } from "@/lib/admin/routes";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { SystemMessagesClient } from "@/components/admin/marketing/SystemMessagesClient";
import { listSystemTemplates } from "@/services/system-messages.service";
import { getCommsSettings } from "@/lib/notify";

export const dynamic = "force-dynamic";

export default async function CommsSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug }, select: { id: true, organizationId: true, name: true } });
  if (!location) return null;
  const admin = await getCurrentAdmin();
  const adminRow = admin ? await prisma.admin.findUnique({ where: { id: admin.id }, select: { email: true, phone: true } }) : null;

  const [entries, comms] = await Promise.all([listSystemTemplates(location.organizationId), getCommsSettings(location.organizationId)]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Communications"
        description="Booking notifications and member-facing system messages for this location."
        meta={
          <div className="flex gap-2">
            <Badge tone={comms.emailEnabled ? "success" : "danger"}>Email {comms.emailEnabled ? "on" : "off"}</Badge>
            <Badge tone={comms.smsEnabled ? "success" : "danger"}>SMS {comms.smsEnabled ? "on" : "off"}</Badge>
          </div>
        }
      />

      <Card>
        <CardHeader title="Booking notifications" subtitle="Confirmations, reminders, and change/cancel notices for bookings." />
        <p className="mt-3 text-apple-sm">
          <Link href={adminRoutes.loc.scheduling.notifications(slug)} className="font-medium text-apple-blue hover:underline">
            Manage booking notifications →
          </Link>
        </p>
      </Card>

      <div>
        <h2 className="text-apple-lg font-semibold text-apple-text">Member system messages</h2>
        <p className="mt-1 text-apple-sm text-apple-text-secondary">
          Transactional messages sent automatically when something happens to a member. These always send (members can&apos;t opt out), unless the organization has
          turned a channel off in <Link href={adminRoutes.settingsEmail()} className="text-apple-blue hover:underline">org email settings</Link>.
          Sender footer, BCC and reply-to come from the same place.
        </p>
      </div>

      <SystemMessagesClient initial={entries} adminEmail={adminRow?.email ?? null} adminPhone={adminRow?.phone ?? null} />
    </div>
  );
}
