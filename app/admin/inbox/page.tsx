import { Suspense } from "react";
import { getPrisma } from "@/lib/db";
import { getAccessibleLocations, getCurrentAdmin, isFullAccess } from "@/lib/access";
import { PageHeader, Badge } from "@/components/ui";
import { InboxClient } from "@/components/admin/marketing/InboxClient";
import { listConversations } from "@/services/inbox.service";
import { getQuoFromNumber } from "@/lib/quo";
import { defaultReplyTo } from "@/lib/inbound-email";

export const dynamic = "force-dynamic";

export default async function OrgInboxPage() {
  const prisma = getPrisma();
  const admin = await getCurrentAdmin();
  if (!admin) return null;
  const locations = await getAccessibleLocations();
  const locationIds = isFullAccess(admin.role) ? undefined : locations.map((l) => l.id);

  const [conversations, admins] = await Promise.all([
    listConversations({ locationIds, status: "OPEN", take: 200 }),
    prisma.admin.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, phone: true } }),
  ]);

  const smsFrom = getQuoFromNumber();
  const replyTo = defaultReplyTo();
  const initial = conversations.map((c) => ({ ...c, lastMessageAt: c.lastMessageAt.toISOString() }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inbox"
        description="Every text and email across all locations — two-way conversations with members and leads, plus a full log of everything sent and received."
        meta={
          <span className="flex flex-wrap gap-1.5">
            {smsFrom ? <Badge tone="muted">Texting from {smsFrom}</Badge> : <Badge tone="warn">No SMS number configured</Badge>}
            {replyTo ? <Badge tone="muted">Replies to {replyTo}</Badge> : <Badge tone="warn">Inbound email not configured</Badge>}
          </span>
        }
      />
      <Suspense>
        <InboxClient initial={initial} admins={admins} currentAdminId={admin.id} scope={{ kind: "org" }} locations={locations} />
      </Suspense>
    </div>
  );
}
