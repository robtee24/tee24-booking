import { getPrisma } from "@/lib/db";
import { TagsManager } from "@/components/admin/members/TagsManager";

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
    <TagsManager
      slug={slug}
      initial={tags.map((t) => ({ id: t.id, name: t.name, color: t.color, memberCount: t._count.members }))}
    />
  );
}
