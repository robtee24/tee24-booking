import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getPrisma } from "@/lib/db";
import { adminRoutes } from "@/lib/admin/routes";
import { PageHeader } from "@/components/ui";
import { NewMemberForm } from "@/components/admin/members/NewMemberForm";

export const dynamic = "force-dynamic";

export default async function NewMemberPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug }, select: { id: true, organizationId: true } });
  if (!location) notFound();

  const [plans, tags, requiredDocs, customFields] = await Promise.all([
    prisma.membershipPlan.findMany({
      where: { archived: false, OR: [{ organizationId: location.organizationId }, { organizationId: null }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, priceCents: true, signupFeeCents: true, billingCadence: true, allowedLocations: true, durationDays: true },
    }),
    prisma.tag.findMany({ where: { OR: [{ organizationId: location.organizationId }, { organizationId: null }] }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
    prisma.document.findMany({ where: { active: true, requiredAtSignup: true, OR: [{ organizationId: location.organizationId }, { organizationId: null }] }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.customFieldDefinition.findMany({ where: { OR: [{ organizationId: location.organizationId }, { organizationId: null }] }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, type: true, options: true, required: true } }),
  ]);
  const visiblePlans = plans
    .filter((p) => !p.allowedLocations || p.allowedLocations.split(",").map((s) => s.trim()).includes(location.id))
    .map(({ allowedLocations: _a, ...p }) => p);

  return (
    <div className="space-y-6">
      <Link href={adminRoutes.loc.members.list(slug)} className="inline-flex items-center gap-1 text-apple-sm text-apple-text-secondary hover:text-apple-text">
        <ArrowLeft className="h-4 w-4" />
        Back to members
      </Link>
      <PageHeader title="Add member" description="Create a member or visitor record, optionally start a plan and send required documents." />
      <NewMemberForm slug={slug} plans={visiblePlans} tags={tags} requiredDocs={requiredDocs} customFields={customFields} />
    </div>
  );
}
