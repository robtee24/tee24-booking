import { notFound } from "next/navigation";
import { getPrisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { PlanForm, planToFormValues } from "@/components/admin/memberships/PlanForm";

export const dynamic = "force-dynamic";

export default async function EditMembershipPlanPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const prisma = getPrisma();
  const plan = await prisma.membershipPlan.findUnique({
    where: { id },
    include: { _count: { select: { subscriptions: { where: { status: { in: ["ACTIVE", "FROZEN", "CANCEL_SCHEDULED", "FREEZE_SCHEDULED", "PENDING"] } } } } } },
  });
  if (!plan) notFound();

  return (
    <div className="space-y-6">
      <PageHeader title={plan.name} description={`Edit plan · ${plan._count.subscriptions} current subscription${plan._count.subscriptions === 1 ? "" : "s"}`} />
      <PlanForm slug={slug} planId={plan.id} initial={planToFormValues(plan)} activeSubscriptions={plan._count.subscriptions} />
    </div>
  );
}
