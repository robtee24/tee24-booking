import { getPrisma } from "@/lib/db";
import { Card, EmptyState, PageHeader, Button, StatusBadge } from "@/components/ui";
import { Plus, Workflow } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AutomationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const automations = await prisma.automation.findMany({
    where: { OR: [{ organizationId: location.organizationId }, { organizationId: null }] },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { _count: { select: { enrollments: true, steps: true } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Automations" description="Triggered flows: signup welcome, failed-payment recovery, win-back, birthday wishes, and more." actions={<Button iconLeft={<Plus className="h-4 w-4" />}>New automation</Button>} />
      {automations.length === 0 ? (
        <EmptyState
          icon={<Workflow className="h-6 w-6" />}
          title="No automations yet"
          description="Build a flow that triggers on signup, payment failure, plan change, attendance milestones, churn risk, birthdays, and more."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {automations.map((a) => (
            <Card key={a.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-apple-text">{a.name}</div>
                  {a.description && <div className="mt-0.5 text-apple-xs text-apple-text-tertiary">{a.description}</div>}
                  <div className="mt-2 text-apple-xs text-apple-text-secondary">
                    Trigger: <span className="font-mono">{a.trigger}</span>
                  </div>
                  <div className="mt-1 text-apple-xs text-apple-text-tertiary">
                    {a._count.steps} step{a._count.steps === 1 ? "" : "s"} · {a._count.enrollments} enrolled
                  </div>
                </div>
                <StatusBadge status={a.active ? "ACTIVE" : "CANCELLED"} size="sm" />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
