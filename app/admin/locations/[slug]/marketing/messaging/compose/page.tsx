import { getPrisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { getCurrentAdmin } from "@/lib/access";
import { getCommsSettings } from "@/lib/notify";
import { MARKETING_MERGE_FIELDS } from "@/services/marketing.service";
import { ComposeClient } from "./ComposeClient";

export const dynamic = "force-dynamic";

export default async function ComposePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ template?: string }> }) {
  const { slug } = await params;
  const { template } = await searchParams;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true, organizationId: true },
  });
  if (!location) notFound();

  const [tags, plans, templates, admin, comms] = await Promise.all([
    prisma.tag.findMany({
      where: { OR: [{ organizationId: location.organizationId }, { organizationId: null }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.membershipPlan.findMany({
      where: { OR: [{ organizationId: location.organizationId }, { organizationId: null }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, category: true },
    }),
    prisma.messageTemplate.findMany({
      where: {
        active: true,
        category: { not: "SYSTEM" },
        OR: [{ organizationId: location.organizationId }, { organizationId: null }],
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, channel: true, category: true, subject: true, body: true },
    }),
    getCurrentAdmin().then((a) => (a ? prisma.admin.findUnique({ where: { id: a.id }, select: { email: true, phone: true } }) : null)),
    getCommsSettings(location.organizationId),
  ]);

  return (
    <ComposeClient
      location={location}
      tags={tags}
      plans={plans}
      templates={templates}
      mergeFields={MARKETING_MERGE_FIELDS}
      admin={{ email: admin?.email ?? null, phone: admin?.phone ?? null }}
      comms={{ emailEnabled: comms.emailEnabled, smsEnabled: comms.smsEnabled }}
      initialTemplateId={template ?? null}
    />
  );
}
