import Link from "next/link";
import { getPrisma } from "@/lib/db";
import { Card, EmptyState, PageHeader, Button, StatusBadge } from "@/components/ui";
import { MessageSquare, Send } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function MessagingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const messages = await prisma.message.findMany({
    where: { member: { locationId: location.id }, category: "MARKETING" },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { member: { select: { id: true, firstName: true, lastName: true } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Messaging"
        description="Bulk emails (Resend) and SMS (Quo). All sends honor opt-out preferences."
        actions={
          <Link href={`/admin/locations/${slug}/marketing/messaging/compose`}>
            <Button iconLeft={<Send className="h-4 w-4" />}>New broadcast</Button>
          </Link>
        }
      />
      <Card padded={false}>
        {messages.length === 0 ? (
          <EmptyState icon={<MessageSquare className="h-6 w-6" />} title="No marketing messages yet" />
        ) : (
          <ul className="divide-y divide-apple-divider">
            {messages.map((m) => (
              <li key={m.id} className="flex items-center justify-between p-4 text-apple-sm">
                <div>
                  <div className="font-medium text-apple-text">{m.subject ?? m.body.slice(0, 80)}</div>
                  <div className="text-apple-xs text-apple-text-tertiary">
                    {m.channel} · to {m.member?.firstName} {m.member?.lastName} · {new Date(m.createdAt).toLocaleString()}
                  </div>
                </div>
                <StatusBadge status={m.status} size="sm" />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
