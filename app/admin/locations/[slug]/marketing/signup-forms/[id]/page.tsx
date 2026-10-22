import { getPrisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader, StatusBadge } from "@/components/ui";
import { SignupFormBuilder } from "@/components/admin/marketing/SignupFormBuilder";
import { draftFromSignupForm, loadSignupBuilderOptions } from "../_options";

export const dynamic = "force-dynamic";

export default async function SignupFormDetailPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug }, select: { id: true, organizationId: true } });
  if (!location) notFound();
  const form = await prisma.signupForm.findUnique({ where: { id } });
  if (!form) notFound();
  const options = await loadSignupBuilderOptions(location, form);
  return (
    <div className="space-y-6">
      <PageHeader title={form.name} description={`/signup/${form.slug}`} meta={<StatusBadge status={form.active ? "ACTIVE" : "PAUSED"} />} />
      <SignupFormBuilder initial={draftFromSignupForm(form)} options={options} />
    </div>
  );
}
