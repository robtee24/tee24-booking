import { getPrisma } from "@/lib/db";
import { Card, EmptyState, PageHeader, Button } from "@/components/ui";
import { Plus, Tag as TagIcon } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function TagsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const tags = await prisma.tag.findMany({
    where: { OR: [{ organizationId: location.organizationId }, { organizationId: null }] },
    include: { _count: { select: { members: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tags"
        description="Tag members for filtering, segmentation, and automation triggers."
        actions={<Button iconLeft={<Plus className="h-4 w-4" />}>New tag</Button>}
      />

      {tags.length === 0 ? (
        <EmptyState icon={<TagIcon className="h-6 w-6" />} title="No tags yet" description="Tags help organize members for marketing & operations." />
      ) : (
        <Card>
          <ul className="divide-y divide-apple-divider">
            {tags.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: t.color ?? "#16a34a" }} />
                  <span className="font-medium text-apple-text">{t.name}</span>
                </div>
                <span className="text-apple-sm text-apple-text-tertiary">{t._count.members} members</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
