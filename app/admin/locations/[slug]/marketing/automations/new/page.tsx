import { getPrisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { AutomationBuilder } from "@/components/admin/marketing/AutomationBuilder";
import { loadBuilderOptions } from "../_options";

export const dynamic = "force-dynamic";

export default async function NewAutomationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const location = await getPrisma().location.findUnique({ where: { slug }, select: { id: true, organizationId: true } });
  if (!location) notFound();
  const options = await loadBuilderOptions(location);
  return (
    <div className="space-y-6">
      <PageHeader title="New automation" description="Pick a trigger, add steps, then activate." />
      <AutomationBuilder options={options} />
    </div>
  );
}
