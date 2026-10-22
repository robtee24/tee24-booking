import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db";
import { getCurrentAdmin, isFullAccess } from "@/lib/access";
import { getActorContext } from "@/lib/actor";
import { can } from "@/lib/permissions";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { adminRoutes } from "@/lib/admin/routes";
import { BarChart, KpiCard } from "@/components/ui/charts";
import { TasksClient, type Filters, type TaskDTO } from "./TasksClient";

export const dynamic = "force-dynamic";

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await getCurrentAdmin();
  if (!admin) return null;
  const sp = await searchParams;
  const prisma = getPrisma();
  const full = isFullAccess(admin.role);
  const myLocationIds = admin.locations.map((l) => l.locationId);

  // "My tasks" is the default view.
  const filters: Filters = {
    assignee: sp.assignee || "me",
    status: sp.status || "open",
    due: sp.due || "all",
    locationId: sp.locationId || "",
    q: sp.q?.trim() || "",
  };

  const visibility: Prisma.TaskWhereInput = full ? {} : { OR: [{ assignedToId: admin.id }, { createdById: admin.id }, { locationId: { in: myLocationIds } }] };

  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const weekEnd = new Date(dayStart.getTime() + 7 * 86_400_000);

  const where: Prisma.TaskWhereInput = {
    AND: [
      visibility,
      filters.assignee === "me" ? { assignedToId: admin.id } : filters.assignee === "unassigned" ? { assignedToId: null } : filters.assignee === "all" ? {} : { assignedToId: filters.assignee },
      filters.status === "open" ? { status: { in: ["OPEN", "IN_PROGRESS"] } } : filters.status === "done" ? { status: { in: ["DONE", "CANCELLED"] } } : {},
      filters.due === "overdue" ? { dueAt: { lt: now }, status: { in: ["OPEN", "IN_PROGRESS"] } } : filters.due === "today" ? { dueAt: { gte: dayStart, lt: dayEnd } } : filters.due === "week" ? { dueAt: { gte: dayStart, lt: weekEnd } } : filters.due === "none" ? { dueAt: null } : {},
      filters.locationId ? { locationId: filters.locationId } : {},
      filters.q ? { OR: [{ title: { contains: filters.q, mode: "insensitive" } }, { body: { contains: filters.q, mode: "insensitive" } }] } : {},
    ],
  };

  const openWhere: Prisma.TaskWhereInput = { AND: [visibility, { status: { in: ["OPEN", "IN_PROGRESS"] } }] };

  const [rows, openAll, mineOpen, dueToday, overdue, unassigned, byAssigneeRaw, admins, locations, actor] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 300,
      include: { assignee: { select: { id: true, name: true, phone: true } }, location: { select: { id: true, name: true, slug: true } } },
    }),
    prisma.task.count({ where: openWhere }),
    prisma.task.count({ where: { AND: [openWhere, { assignedToId: admin.id }] } }),
    prisma.task.count({ where: { AND: [openWhere, { dueAt: { gte: dayStart, lt: dayEnd } }] } }),
    prisma.task.count({ where: { AND: [openWhere, { dueAt: { lt: now } }] } }),
    prisma.task.count({ where: { AND: [openWhere, { assignedToId: null }] } }),
    prisma.task.groupBy({ by: ["assignedToId"], _count: { _all: true }, where: openWhere }),
    full
      ? prisma.admin.findMany({ select: { id: true, name: true, phone: true }, orderBy: { name: "asc" } })
      : prisma.admin.findMany({ where: { OR: [{ id: admin.id }, { locations: { some: { locationId: { in: myLocationIds } } } }] }, select: { id: true, name: true, phone: true }, orderBy: { name: "asc" } }),
    full ? prisma.location.findMany({ select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } }) : Promise.resolve(admin.locations.map((l) => l.location)),
    getActorContext(),
  ]);

  const canManage = can(actor, "ops.tasks");

  // Attach member chips in one query.
  const memberIds = [...new Set(rows.map((r) => r.memberId).filter((x): x is string => !!x))];
  const members = memberIds.length
    ? await prisma.member.findMany({ where: { id: { in: memberIds } }, select: { id: true, firstName: true, lastName: true, phone: true, location: { select: { slug: true } } } })
    : [];
  const memberMap = new Map(members.map((m) => [m.id, { id: m.id, firstName: m.firstName, lastName: m.lastName, phone: m.phone, locationSlug: m.location.slug }]));

  const tasks: TaskDTO[] = rows.map((t) => ({
    id: t.id,
    title: t.title,
    body: t.body,
    status: t.status,
    priority: t.priority,
    dueAt: t.dueAt?.toISOString() ?? null,
    memberId: t.memberId,
    assignedToId: t.assignedToId,
    locationId: t.locationId,
    createdById: t.createdById,
    completedAt: t.completedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    assignee: t.assignee,
    location: t.location,
    member: t.memberId ? memberMap.get(t.memberId) ?? null : null,
  }));

  const adminName = new Map(admins.map((a) => [a.id, a.name ?? a.phone]));
  const assigneeData = byAssigneeRaw
    .map((r) => ({ name: r.assignedToId ? adminName.get(r.assignedToId) ?? "Teammate" : "Unassigned", tasks: r._count._all }))
    .sort((a, b) => b.tasks - a.tasks)
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <PageHeader title="Tasks" description="Staff to-do list and CRM follow-ups." />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <KpiCard label="My open" value={mineOpen.toLocaleString()} href={`${adminRoutes.tasks()}?assignee=me`} />
        <KpiCard label="All open" value={openAll.toLocaleString()} href={`${adminRoutes.tasks()}?assignee=all`} />
        <KpiCard label="Due today" value={dueToday.toLocaleString()} href={`${adminRoutes.tasks()}?assignee=all&due=today`} />
        <KpiCard label="Overdue" value={overdue.toLocaleString()} hint={overdue > 0 ? "Review now" : undefined} href={`${adminRoutes.tasks()}?assignee=all&due=overdue`} />
        <KpiCard label="Unassigned" value={unassigned.toLocaleString()} href={`${adminRoutes.tasks()}?assignee=unassigned`} />
      </div>

      <TasksClient tasks={tasks} admins={admins} locations={locations} filters={filters} meId={admin.id} canManage={canManage} />

      {assigneeData.length > 1 && (
        <Card>
          <CardHeader title="Workload" subtitle="Open tasks by assignee" />
          <div className="mt-4">
            <BarChart data={assigneeData} xKey="name" series={[{ key: "tasks", label: "Tasks" }]} layout="vertical" height={Math.max(160, assigneeData.length * 28)} />
          </div>
        </Card>
      )}
    </div>
  );
}
