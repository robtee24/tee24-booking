import { getPrisma } from "@/lib/db";
import { getCurrentAdmin, isFullAccess } from "@/lib/access";
import { Card, CardHeader, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { BarChart, KpiCard } from "@/components/ui/charts";
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

  const now = new Date();
  const overdue = tasks.filter((t) => t.dueAt && t.dueAt < now).length;
  const dueToday = tasks.filter((t) => {
    if (!t.dueAt) return false;
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    return t.dueAt <= todayEnd && t.dueAt >= new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }).length;
  const unassigned = tasks.filter((t) => !t.assignee).length;

  // Tasks per assignee
  const byAssignee = new Map<string, number>();
  for (const t of tasks) {
    const k = t.assignee?.name ?? "Unassigned";
    byAssignee.set(k, (byAssignee.get(k) ?? 0) + 1);
  }
  const assigneeData = Array.from(byAssignee.entries())
    .map(([name, value]) => ({ name, tasks: value }))
    .sort((a, b) => b.tasks - a.tasks)
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <PageHeader title="Tasks" description="Staff to-do list and CRM follow-ups." />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Open" value={tasks.length.toLocaleString()} />
        <KpiCard label="Due today" value={dueToday.toLocaleString()} />
        <KpiCard label="Overdue" value={overdue.toLocaleString()} hint={overdue > 0 ? "Review now" : undefined} />
        <KpiCard label="Unassigned" value={unassigned.toLocaleString()} />
      </div>

      {assigneeData.length > 0 && (
        <Card>
          <CardHeader title="Workload" subtitle="Open tasks by assignee" />
          <div className="mt-4">
            <BarChart
              data={assigneeData}
              xKey="name"
              series={[{ key: "tasks", label: "Tasks" }]}
              layout="vertical"
              height={Math.max(220, assigneeData.length * 28)}
            />
          </div>
        </Card>
      )}

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
