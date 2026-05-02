import { getPrisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { ComposeClient } from "./ComposeClient";

export const dynamic = "force-dynamic";

export default async function ComposePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true, organizationId: true },
  });
  if (!location) notFound();

  const [tags, plans, templates] = await Promise.all([
    prisma.tag.findMany({
      where: { OR: [{ organizationId: location.organizationId }, { organizationId: null }] },
      orderBy: { name: "asc" },
    }),
    prisma.membershipPlan.findMany({
      where: { OR: [{ organizationId: location.organizationId }, { organizationId: null }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, category: true },
    }),
    prisma.messageTemplate.findMany({
      where: {
        active: true,
        OR: [{ organizationId: location.organizationId }, { organizationId: null }],
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, channel: true, category: true, subject: true },
    }),
  ]);

  return <ComposeClient location={location} tags={tags} plans={plans} templates={templates} />;
}
