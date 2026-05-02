import { Card, CardHeader, EmptyState, StatusBadge } from "@/components/ui";
import { getCurrentMember } from "@/lib/member-session";
import { getPrisma } from "@/lib/db";
import { MessageSquare } from "lucide-react";
import { ContactComposer } from "./ContactComposer";

export const dynamic = "force-dynamic";

export default async function PortalContact() {
  const member = await getCurrentMember();
  if (!member) return null;
  const prisma = getPrisma();

  const messages = await prisma.message.findMany({
    where: { memberId: member.id },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-apple-2xl font-semibold tracking-tight">Contact</h1>

      <ContactComposer />

      <Card>
        <CardHeader title="Conversations" subtitle="Recent messages with the team." />
        {messages.length === 0 ? (
          <EmptyState icon={<MessageSquare className="h-6 w-6" />} title="No messages yet" />
        ) : (
          <ul className="mt-3 divide-y divide-apple-divider">
            {messages.map((m) => (
              <li key={m.id} className="py-2 text-apple-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-apple-text">
                    {m.subject ?? (m.direction === "INBOUND" ? "From you" : "From staff")}
                  </span>
                  <StatusBadge status={m.status} size="sm" />
                </div>
                <p className="mt-1 text-apple-text-secondary">{m.body.slice(0, 280)}</p>
                <div className="mt-1 text-apple-xs text-apple-text-tertiary">
                  {m.channel} · {new Date(m.createdAt).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
