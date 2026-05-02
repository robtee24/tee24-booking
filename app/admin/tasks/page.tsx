import { getPrisma } from "@/lib/db";
import { getCurrentAdmin, isFullAccess } from "@/lib/access";
import { Card, CardHeader, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { ListTodo } from "lucide-react";
import { TasksClient } from "./TasksClient";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const admin = await getCurrentAdmin();
  if (!admin) return null;
  const prisma = getPrisma();

  const where: any = { status: { in: ["OPEN", "IN_PROGRESS"] } };
  if (!isFullAccess(admin.role)) {
    where.OR = [
      { assignedToId: admin.id },
      { locationId: { in: admin.locations.map((l) => l.locationId) } },
    ];
  }

  const tasks = await prisma.task.findMany({
    where,
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    include: {
      assignee: { select: { id: true, name: true } },
      location: { select: { name: true, slug: true } },
    },
  });

  const admins = await prisma.admin.findMany({
    select: { id: true, name: true, phone: true },
  });
  const locations = isFullAccess(admin.role)
    ? await prisma.location.findMany({ select: { id: true, name: true, slug: true } })
    : admin.locations.map((l) => l.location);

  return (
    <div className="space-y-6">
      <PageHeader title="Tasks" description="Staff to-do list and CRM follow-ups." />

      <TasksClient tasks={tasks as any} admins={admins} locations={locations} />

      <Card padded={false}>
        <CardHeader title="Open tasks" className="p-5" />
        {tasks.length === 0 ? (
          <EmptyState icon={<ListTodo className="h-6 w-6" />} title="Nothing on the list" description="Add a task to get started." />
        ) : (
          <ul className="divide-y divide-apple-divider">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 p-4 text-apple-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-apple-text">{t.title}</div>
                  {t.body && <div className="mt-1 line-clamp-2 text-apple-text-secondary">{t.body}</div>}
                  <div className="mt-1 text-apple-xs text-apple-text-tertiary">
                    {t.location?.name ?? "—"} · Assigned to {t.assignee?.name ?? "Unassigned"} · {t.dueAt ? `Due ${new Date(t.dueAt).toLocaleString()}` : "No due date"}
                  </div>
                </div>
                <StatusBadge status={t.status} size="sm" />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
