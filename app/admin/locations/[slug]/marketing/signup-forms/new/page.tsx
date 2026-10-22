import { getPrisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { SignupFormBuilder } from "@/components/admin/marketing/SignupFormBuilder";
import { emptySignupDraft, loadSignupBuilderOptions } from "../_options";

export const dynamic = "force-dynamic";

export default async function NewSignupFormPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const location = await getPrisma().location.findUnique({ where: { slug }, select: { id: true, organizationId: true } });
  if (!location) notFound();
  const options = await loadSignupBuilderOptions(location);
  return (
    <div className="space-y-6">
      <PageHeader title="New signup form" description="Pick plans, choose fields, and share the link." />
      <SignupFormBuilder initial={emptySignupDraft()} options={options} />
    </div>
  );
}
