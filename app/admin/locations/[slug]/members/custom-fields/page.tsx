import { getPrisma } from "@/lib/db";
import { CustomFieldsManager } from "@/components/admin/members/CustomFieldsManager";

export const dynamic = "force-dynamic";

export default async function CustomFieldsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const fields = await prisma.customFieldDefinition.findMany({
    where: { OR: [{ organizationId: location.organizationId }, { organizationId: null }] },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return <CustomFieldsManager slug={slug} initial={fields} />;
}
