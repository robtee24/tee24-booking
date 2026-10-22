import { Suspense } from "react";
import { getPrisma } from "@/lib/db";
import { getCurrentAdmin } from "@/lib/access";
import { PageHeader, Badge } from "@/components/ui";
import { InboxClient } from "@/components/admin/marketing/InboxClient";
import { listConversations } from "@/services/inbox.service";
import { getQuoFromNumber } from "@/lib/quo";

export const dynamic = "force-dynamic";

export default async function InboxPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const [conversations, admins, admin] = await Promise.all([
    listConversations({ locationId: location.id, status: "OPEN" }),
    prisma.admin.findMany({
      where: { OR: [{ role: { in: ["ROOT", "FULL"] } }, { locations: { some: { locationId: location.id } } }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true },
    }),
    getCurrentAdmin(),
  ]);

  const smsFrom = getQuoFromNumber();
  const initial = conversations.map((c) => ({ ...c, lastMessageAt: c.lastMessageAt.toISOString() }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inbox"
        description="Two-way texts and emails with members and leads at this location. Inbound texts, emails and website forms land here automatically."
        meta={smsFrom ? <Badge tone="muted">Texting from {smsFrom}</Badge> : <Badge tone="warn">No SMS number configured</Badge>}
      />
      <Suspense>
        <InboxClient
          initial={initial}
          admins={admins}
          currentAdminId={admin?.id ?? null}
          scope={{ kind: "location", locationId: location.id, slug }}
          locations={[{ id: location.id, slug: location.slug, name: location.name }]}
        />
      </Suspense>
    </div>
  );
}
