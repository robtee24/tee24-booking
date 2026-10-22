import { getPrisma } from "@/lib/db";
import type { BuilderOptions } from "@/components/admin/marketing/AutomationBuilder";

/** Shared option lists for the automation builder (plans, tags, admins, templates). */
export async function loadBuilderOptions(location: { id: string; organizationId: string | null }): Promise<BuilderOptions> {
  const prisma = getPrisma();
  const orgFilter = { OR: [{ organizationId: location.organizationId }, { organizationId: null }] };
  const [plans, tags, admins, templates] = await Promise.all([
    prisma.membershipPlan.findMany({ where: orgFilter, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.tag.findMany({ where: orgFilter, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.admin.findMany({
      where: { OR: [{ role: { in: ["ROOT", "FULL"] } }, { locations: { some: { locationId: location.id } } }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true },
    }),
    prisma.messageTemplate.findMany({ where: { ...orgFilter, active: true, category: { not: "SYSTEM" } }, orderBy: { name: "asc" }, select: { id: true, name: true, channel: true, subject: true } }),
  ]);
  return { plans, tags, admins, templates };
}
