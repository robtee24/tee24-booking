import { getPrisma } from "@/lib/db";
import { getCurrentAdmin, isFullAccess } from "@/lib/access";
import { PageHeader } from "@/components/ui";
import { KpiCard } from "@/components/ui/charts";
import { listTransferRequests } from "@/services/mobile-auth.service";
import { MobileAppClient, type DeviceDTO, type TransferDTO } from "./MobileAppClient";

export const dynamic = "force-dynamic";

export default async function MobileAppPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await getCurrentAdmin();
  if (!admin) return null;
  const sp = await searchParams;
  const prisma = getPrisma();
  const full = isFullAccess(admin.role);
  const locationIds = full ? undefined : admin.locations.map((l) => l.locationId);
  const scope = locationIds ? { member: { locationId: { in: locationIds } } } : {};
  const since30 = new Date();
  since30.setDate(since30.getDate() - 30);

  const [pending, recent, devices, pushDevices, activeSessions, unlocks30, imports30] = await Promise.all([
    listTransferRequests({ status: "PENDING", locationIds, limit: 100 }),
    listTransferRequests({ locationIds, limit: 40 }).then((rows) => rows.filter((r) => r.status !== "PENDING")),
    prisma.memberDevice.count({ where: { revokedAt: null, ...scope } }),
    prisma.memberDevice.count({ where: { revokedAt: null, pushEnabled: true, ...scope } }),
    prisma.mobileSession.count({ where: { revokedAt: null, expiresAt: { gt: new Date() }, ...scope } }),
    prisma.visit.count({ where: { source: "MOBILE_APP", enteredAt: { gte: since30 }, ...(locationIds ? { locationId: { in: locationIds } } : {}) } }),
    prisma.practiceSession.count({ where: { source: "GSPRO_CSV", createdAt: { gte: since30 }, ...scope } }),
  ]);

  const toDto = (r: (typeof pending)[number]): TransferDTO => ({
    id: r.id,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    resolutionNote: r.resolutionNote,
    memberNote: r.memberNote,
    toDeviceName: r.toDeviceName,
    toDeviceModel: r.toDeviceModel,
    toPlatform: r.toPlatform,
    member: { id: r.member.id, firstName: r.member.firstName, lastName: r.member.lastName, phone: r.member.phone, email: r.member.email, locationSlug: r.member.location.slug, locationName: r.member.location.name },
  });

  const initialDevices: DeviceDTO[] = (
    await prisma.memberDevice.findMany({
      where: { revokedAt: null, ...scope },
      include: { member: { select: { id: true, firstName: true, lastName: true, phone: true, email: true, location: { select: { slug: true, name: true } } } } },
      orderBy: { lastSeenAt: { sort: "desc", nulls: "last" } },
      take: 50,
    })
  ).map((d) => ({
    id: d.id,
    platform: d.platform,
    name: d.name,
    model: d.model,
    osVersion: d.osVersion,
    appVersion: d.appVersion,
    boundAt: d.boundAt.toISOString(),
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    pushEnabled: d.pushEnabled,
    pushPermission: d.pushPermission,
    member: { id: d.member.id, firstName: d.member.firstName, lastName: d.member.lastName, phone: d.member.phone, email: d.member.email, locationSlug: d.member.location.slug, locationName: d.member.location.name },
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Mobile App" description="Member app devices, new-phone requests and usage." />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="New phone requests" value={pending.length.toLocaleString()} hint={pending.length ? "Needs a decision" : undefined} />
        <KpiCard label="Bound devices" value={devices.toLocaleString()} />
        <KpiCard label="Push enabled" value={pushDevices.toLocaleString()} hint={devices ? `${Math.round((pushDevices / devices) * 100)}% of devices · rest get SMS` : "Members without push get SMS"} />
        <KpiCard label="Active sessions" value={activeSessions.toLocaleString()} />
        <KpiCard label="App unlocks · 30d" value={unlocks30.toLocaleString()} />
        <KpiCard label="GSPro imports · 30d" value={imports30.toLocaleString()} />
      </div>
      <MobileAppClient pending={pending.map(toDto)} recent={recent.map(toDto)} devices={initialDevices} highlightRequestId={sp.request ?? null} />
    </div>
  );
}
