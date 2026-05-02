import Link from "next/link";
import { getPrisma } from "@/lib/db";
import { getCurrentAdmin, isFullAccess } from "@/lib/access";
import { Card, CardHeader, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { Bell } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function NotificationsInbox() {
  const admin = await getCurrentAdmin();
  if (!admin) return null;
  const prisma = getPrisma();

  const where: any = {};
  if (!isFullAccess(admin.role)) {
    where.locationId = { in: admin.locations.map((l) => l.locationId) };
  }

  const [notes, unread] = await Promise.all([
    prisma.adminNotification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.adminNotification.count({ where: { ...where, readAt: null } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description={`${unread} unread`}
      />

      <Card padded={false}>
        {notes.length === 0 ? (
          <EmptyState icon={<Bell className="h-6 w-6" />} title="Inbox zero" description="No notifications yet." />
        ) : (
          <ul className="divide-y divide-apple-divider">
            {notes.map((n) => (
              <li key={n.id} className={`p-4 ${!n.readAt ? "bg-apple-blue/5" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-apple-text">{n.title}</span>
                      <StatusBadge status={n.severity} size="sm" />
                    </div>
                    {n.body && <p className="mt-1 text-apple-sm text-apple-text-secondary">{n.body}</p>}
                    <div className="mt-1 text-apple-xs text-apple-text-tertiary">
                      {n.kind} · {new Date(n.createdAt).toLocaleString()}
                    </div>
                  </div>
                  {n.link && (
                    <Link href={n.link} className="text-apple-sm text-apple-blue hover:underline">
                      Open
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
