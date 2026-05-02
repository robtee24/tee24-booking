import { getPrisma } from "@/lib/db";
import { Card, EmptyState, PageHeader, Button, StatusBadge } from "@/components/ui";
import { Plus, Database } from "lucide-react";

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Custom fields"
        description="Add additional questions to signup forms and member profiles."
        actions={<Button iconLeft={<Plus className="h-4 w-4" />}>New field</Button>}
      />
      {fields.length === 0 ? (
        <EmptyState icon={<Database className="h-6 w-6" />} title="No custom fields" />
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-apple-divider">
            {fields.map((f) => (
              <li key={f.id} className="flex items-center justify-between p-4">
                <div>
                  <div className="font-medium text-apple-text">{f.name}</div>
                  <div className="text-apple-xs text-apple-text-tertiary">{f.key} · {f.type}{f.required ? " · required" : ""}</div>
                </div>
                <div className="flex items-center gap-2">
                  {f.showOnSignup && <StatusBadge status="ACTIVE" size="sm" />}
                  {f.adminOnly && <StatusBadge status="VISITOR" size="sm" />}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
