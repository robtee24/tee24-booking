import Link from "next/link";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { AreaChart, BarChart, KpiCard } from "@/components/ui/charts";
import { getPrisma } from "@/lib/db";
import { getAccessibleLocationIds } from "@/lib/access";
import { adminRoutes } from "@/lib/admin/routes";
import { lastNDays, lastNMonths } from "@/lib/chart-data";
import { Building2, Users, Settings, BarChart3 } from "lucide-react";
import { LocationRowActions } from "@/components/admin/staff/LocationRowActions";
import { DateRangeSelect, parseRange, rangeBounds } from "@/components/admin/staff/DateRangeSelect";

export const dynamic = "force-dynamic";

export default async function AdminHomePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const prisma = getPrisma();
  const sp = await searchParams;
  const locationIds = await getAccessibleLocationIds();

  const now = new Date();
  const range = parseRange(sp.range, "mtd");
  const bounds = rangeBounds(range, now);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

  // Each widget is isolated so one failing query can't 500 the whole overview.
  const [activeMembers, locationCount, rangeRev, visitsToday, visits7d, signupsByMonth, newLeads30d, locations, revByLocation, membersByLoc] = await Promise.all([
    safe(() => prisma.member.count({ where: { locationId: { in: locationIds }, status: "ACTIVE" } }), 0),
    safe(() => prisma.location.count({ where: { id: { in: locationIds } } }), locationIds.length),
    safe(
      () =>
        prisma.charge.aggregate({
          _sum: { amountCents: true },
          where: { locationId: { in: locationIds }, status: "SUCCEEDED", createdAt: { gte: bounds.start, lt: bounds.end } },
        }),
      { _sum: { amountCents: 0 } }
    ),
    safe(() => prisma.visit.count({ where: { locationId: { in: locationIds }, enteredAt: { gte: todayStart } } }), 0),
    safe(
      () =>
        prisma.visit.findMany({
          where: { locationId: { in: locationIds }, enteredAt: { gte: sevenDaysAgo } },
          select: { enteredAt: true },
        }),
      [] as { enteredAt: Date }[]
    ),
    safe(
      () =>
        prisma.member.findMany({
          where: { locationId: { in: locationIds }, joinDate: { gte: yearAgo } },
          select: { joinDate: true },
        }),
      [] as { joinDate: Date | null }[]
    ),
    safe(() => prisma.visitor.count({ where: { OR: [{ locationId: { in: locationIds } }, { locationId: null }], createdAt: { gte: thirtyDaysAgo } } }), 0),
    safe(
      () => prisma.location.findMany({ where: { id: { in: locationIds } }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, slug: true, disabled: true, city: true, state: true, createdAt: true } }),
      [] as { id: string; name: string; slug: string; disabled: boolean; city: string | null; state: string | null; createdAt: Date }[]
    ),
    safe(
      () => prisma.charge.groupBy({ by: ["locationId"], _sum: { amountCents: true }, where: { locationId: { in: locationIds }, status: "SUCCEEDED", createdAt: { gte: bounds.start, lt: bounds.end } } }),
      [] as { locationId: string | null; _sum: { amountCents: number | null } }[]
    ),
    safe(
      () => prisma.member.groupBy({ by: ["locationId"], _count: { _all: true }, where: { locationId: { in: locationIds }, status: "ACTIVE" } }),
      [] as { locationId: string; _count: { _all: number } }[]
    ),
  ]);

  // HQ = the first location ever created in the org.
  const hqId = locations[0]?.id ?? null;
  const revMap = new Map(revByLocation.map((r) => [r.locationId, r._sum.amountCents ?? 0]));
  const memMap = new Map(membersByLoc.map((r) => [r.locationId, r._count._all]));
  const perLocationChart = locations.map((l) => ({ name: l.name, revenue: Math.round((revMap.get(l.id) ?? 0) / 100), members: memMap.get(l.id) ?? 0 }));

  const days = lastNDays(7);
  const dailyVisits = days.map((iso) => ({
    label: new Date(iso).toLocaleDateString(undefined, { weekday: "short" }),
    visits: visits7d.filter((v) => v.enteredAt.toISOString().slice(0, 10) === iso).length,
  }));
  const dailySpark = dailyVisits.map((d) => ({ y: d.visits }));

  const months = lastNMonths(12);
  const signupTrend = months.map((m) => ({
    month: m.label,
    signups: signupsByMonth.filter((s) => s.joinDate && s.joinDate >= m.start && s.joinDate < m.end).length,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization overview"
        description="Roll-up across all your locations."
        actions={<DateRangeSelect value={range} basePath={adminRoutes.home()} />}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard label="Active members" value={activeMembers.toLocaleString()} href={adminRoutes.franchise()} />
        <KpiCard
          label={`Revenue · ${range === "mtd" ? "MTD" : bounds.label}`}
          value={`$${((rangeRev._sum?.amountCents ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          hint="Successful charges"
        />
        <KpiCard label="New leads (30d)" value={newLeads30d.toLocaleString()} hint="Visitors captured" />
        <KpiCard label="Visits today" value={visitsToday.toLocaleString()} trend={dailySpark} />
        <KpiCard label="Locations" value={locationCount.toLocaleString()} href={adminRoutes.locations()} />
      </div>

      <Card padded={false}>
        <CardHeader title="Locations" subtitle={`Revenue for ${bounds.label.toLowerCase()} · active members`} className="p-5 pb-3" />
        {locations.length === 0 ? (
          <p className="px-5 pb-5 text-apple-sm text-apple-text-tertiary">No locations accessible.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-apple-sm">
              <thead className="border-y border-apple-divider bg-apple-fill-secondary text-apple-xs uppercase text-apple-text-tertiary">
                <tr>
                  <th className="px-5 py-2 text-left">Location</th>
                  <th className="px-3 py-2 text-right">Active members</th>
                  <th className="px-3 py-2 text-right">Revenue</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-apple-divider">
                {locations.map((l) => (
                  <tr key={l.id} className="hover:bg-apple-fill-secondary/60">
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <Link href={adminRoutes.loc.dashboard(l.slug)} className="font-medium text-apple-text hover:text-apple-blue">{l.name}</Link>
                        {l.id === hqId && <Badge tone="info" size="sm">HQ</Badge>}
                      </div>
                      <div className="text-apple-xs text-apple-text-tertiary">{[l.city, l.state].filter(Boolean).join(", ") || l.slug}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{(memMap.get(l.id) ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">${((revMap.get(l.id) ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="px-3 py-2.5">{l.disabled ? <Badge tone="danger" size="sm">Disabled</Badge> : <Badge tone="success" size="sm">Live</Badge>}</td>
                    <td className="px-3 py-2.5 text-right"><LocationRowActions slug={l.slug} name={l.name} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {perLocationChart.length > 1 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Revenue by location" subtitle={bounds.label} />
            <div className="mt-4">
              <BarChart data={perLocationChart} xKey="name" series={[{ key: "revenue", label: "Revenue" }]} yFormat="currency" height={200} colorByCell />
            </div>
          </Card>
          <Card>
            <CardHeader title="Active members by location" />
            <div className="mt-4">
              <BarChart data={perLocationChart} xKey="name" series={[{ key: "members", label: "Members" }]} height={200} layout="vertical" />
            </div>
          </Card>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Visits — last 7 days" subtitle="Org-wide" />
          <div className="mt-4">
            <BarChart
              data={dailyVisits}
              xKey="label"
              series={[{ key: "visits", label: "Visits" }]}
              height={200}
              colorByCell
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Signups — last 12 months" subtitle="New members per month" />
          <div className="mt-4">
            <AreaChart
              data={signupTrend}
              xKey="month"
              series={[{ key: "signups", label: "Signups" }]}
              height={200}
            />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <NavCard
          href={adminRoutes.franchise()}
          label="Franchise"
          description="Cross-location KPIs and rollups."
          icon={<BarChart3 className="h-5 w-5" />}
          accent="blue"
        />
        <NavCard
          href={adminRoutes.locations()}
          label="Locations"
          description="Manage hours, bays, Kisi, and Bay App."
          icon={<Building2 className="h-5 w-5" />}
          accent="green"
        />
        <NavCard
          href={adminRoutes.admins()}
          label="Admins"
          description="Roles, permissions, and 2FA."
          icon={<Users className="h-5 w-5" />}
          accent="orange"
        />
        <NavCard
          href={adminRoutes.settings()}
          label="Settings"
          description="Org defaults, integrations, audit log."
          icon={<Settings className="h-5 w-5" />}
          accent="purple"
        />
      </div>
    </div>
  );
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error("[admin overview] widget query failed:", err instanceof Error ? err.message : err);
    return fallback;
  }
}

function NavCard({
  href,
  label,
  description,
  icon,
  accent,
}: {
  href: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  accent: "blue" | "green" | "orange" | "purple";
}) {
  const accentClasses: Record<string, string> = {
    blue: "bg-apple-blue/10 text-apple-blue",
    green: "bg-apple-green/10 text-apple-green",
    orange: "bg-apple-orange/10 text-apple-orange",
    purple: "bg-apple-purple/10 text-apple-purple",
  };
  return (
    <Link
      href={href}
      className="group rounded-apple bg-white p-5 shadow-apple transition-all hover:-translate-y-0.5 hover:shadow-apple-md"
    >
      <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-apple-sm ${accentClasses[accent]}`}>
        {icon}
      </div>
      <h2 className="text-apple-base font-semibold text-apple-text">{label}</h2>
      <p className="mt-1 text-apple-sm text-apple-text-secondary">{description}</p>
      <span className="mt-3 inline-block text-apple-sm font-medium text-apple-blue group-hover:underline">
        Open →
      </span>
    </Link>
  );
}
