import Link from "next/link";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { AreaChart, BarChart, KpiCard } from "@/components/ui/charts";
import { getPrisma } from "@/lib/db";
import { getAccessibleLocationIds } from "@/lib/access";
import { lastNDays, lastNMonths } from "@/lib/chart-data";
import { Building2, Users, Settings, BarChart3 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  const prisma = getPrisma();
  const locationIds = await getAccessibleLocationIds();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);

  const [activeMembers, locationCount, mtdRev, visitsToday, visits7d, signupsByMonth] = await Promise.all([
    prisma.member.count({ where: { locationId: { in: locationIds }, status: "ACTIVE" } }),
    prisma.location.count({ where: { id: { in: locationIds } } }),
    prisma.charge.aggregate({
      _sum: { amountCents: true },
      where: { locationId: { in: locationIds }, status: "SUCCEEDED", createdAt: { gte: monthStart } },
    }),
    prisma.visit.count({ where: { locationId: { in: locationIds }, enteredAt: { gte: todayStart } } }),
    prisma.visit.findMany({
      where: { locationId: { in: locationIds }, enteredAt: { gte: sevenDaysAgo } },
      select: { enteredAt: true },
    }),
    prisma.member.findMany({
      where: { locationId: { in: locationIds }, joinDate: { gte: yearAgo } },
      select: { joinDate: true },
    }),
  ]);

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
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard
          label="Active members"
          value={activeMembers.toLocaleString()}
        />
        <KpiCard
          label="Revenue MTD"
          value={`$${((mtdRev._sum?.amountCents ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
        />
        <KpiCard
          label="Visits today"
          value={visitsToday.toLocaleString()}
          trend={dailySpark}
        />
        <KpiCard
          label="Locations"
          value={locationCount.toLocaleString()}
        />
      </div>

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
          href="/admin/franchise"
          label="Franchise"
          description="Cross-location KPIs and rollups."
          icon={<BarChart3 className="h-5 w-5" />}
          accent="blue"
        />
        <NavCard
          href="/admin/locations"
          label="Locations"
          description="Manage hours, bays, Kisi, and Bay App."
          icon={<Building2 className="h-5 w-5" />}
          accent="green"
        />
        <NavCard
          href="/admin/admins"
          label="Admins"
          description="Roles, permissions, and 2FA."
          icon={<Users className="h-5 w-5" />}
          accent="orange"
        />
        <NavCard
          href="/admin/settings"
          label="Settings"
          description="Org defaults, integrations, audit log."
          icon={<Settings className="h-5 w-5" />}
          accent="purple"
        />
      </div>
    </div>
  );
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
