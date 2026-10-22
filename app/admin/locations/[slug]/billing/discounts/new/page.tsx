import Link from "next/link";
import { getPrisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { ArrowLeft } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { DiscountForm, EMPTY_DISCOUNT } from "@/components/admin/billing/DiscountForm";

export const dynamic = "force-dynamic";

export default async function NewDiscountPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const [plans, forms] = await Promise.all([
    prisma.membershipPlan.findMany({ where: { archived: false, OR: [{ organizationId: location.organizationId }, { organizationId: null }] }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.signupForm.findMany({ where: { OR: [{ locationId: location.id }, { organizationId: location.organizationId }] }, select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <Link href={adminRoutes.loc.billing.discounts(slug)} className="inline-flex items-center gap-1 text-apple-sm text-apple-text-secondary hover:text-apple-text">
        <ArrowLeft className="h-4 w-4" /> Discounts
      </Link>
      <PageHeader title="New discount" description="Codes are shared across all locations in your organization." />
      <DiscountForm slug={slug} initial={EMPTY_DISCOUNT} plans={plans} signupForms={forms} />
    </div>
  );
}
