import { getPrisma } from "@/lib/db";
import { Card, EmptyState, PageHeader, Button, StatusBadge } from "@/components/ui";
import { Plus, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function TemplatesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const templates = await prisma.messageTemplate.findMany({
    where: { OR: [{ organizationId: location.organizationId }, { organizationId: null }] },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Templates" description="Reusable email & SMS bodies with merge fields." actions={<Button iconLeft={<Plus className="h-4 w-4" />}>New template</Button>} />
      {templates.length === 0 ? (
        <EmptyState icon={<Sparkles className="h-6 w-6" />} title="No templates yet" />
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-apple-divider">
            {templates.map((t) => (
              <li key={t.id} className="flex items-center justify-between p-4">
                <div>
                  <div className="font-medium text-apple-text">{t.name}</div>
                  <div className="text-apple-xs text-apple-text-tertiary">{t.channel} · {t.category}{t.subject ? ` · ${t.subject}` : ""}</div>
                </div>
                <StatusBadge status={t.active ? "ACTIVE" : "CANCELLED"} size="sm" />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
