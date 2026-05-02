import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { LayoutDashboard } from "lucide-react";
import { getPrisma } from "@/lib/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function LocationDashboard({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" />
        <EmptyState
          icon={<LayoutDashboard className="h-6 w-6" />}
          title="Location not found"
          description={`No location with slug "${slug}".`}
        />
      </div>
    );
  }

  // Period: month-to-date
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [
    activeMembers,
    visitorsCount,
    frozenMembers,
    invoicesMTD,
    overdueInvoices,
    visitsToday,
    upcomingBookings,
    recentNotifications,
  ] = await Promise.all([
    prisma.member.count({ where: { locationId: location.id, status: "ACTIVE" } }),
    prisma.member.count({ where: { locationId: location.id, status: "VISITOR" } }),
    prisma.member.count({ where: { locationId: location.id, status: "FROZEN" } }),
    prisma.invoice.aggregate({
      _sum: { totalCents: true },
      where: { locationId: location.id, dueDate: { gte: monthStart }, status: { in: ["PAID", "SCHEDULED"] } },
    }),
    prisma.invoice.aggregate({
      _sum: { totalCents: true },
      _count: true,
      where: { locationId: location.id, status: { in: ["PAST_DUE", "FAILED"] } },
    }),
    prisma.visit.count({ where: { locationId: location.id, enteredAt: { gte: todayStart } } }),
    prisma.booking.count({ where: { locationId: location.id, start: { gte: now }, canceledAt: null } }),
    prisma.adminNotification.findMany({
      where: { locationId: location.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const expectedMtd = invoicesMTD._sum?.totalCents ?? 0;
  const overdueAmt = overdueInvoices._sum?.totalCents ?? 0;
  const overdueCnt = overdueInvoices._count ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={location.name}
        description="Today at a glance"
        meta={
          <span className="text-apple-xs text-apple-text-tertiary">
            {now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </span>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Active members" value={activeMembers.toLocaleString()} href={`/admin/locations/${slug}/members/list`} />
        <KpiCard label="Visitors" value={visitorsCount.toLocaleString()} href={`/admin/locations/${slug}/members/list?status=VISITOR`} />
        <KpiCard label="Frozen" value={frozenMembers.toLocaleString()} href={`/admin/locations/${slug}/members/list?status=FROZEN`} />
        <KpiCard label="Visits today" value={visitsToday.toLocaleString()} href={`/admin/locations/${slug}/members/attendance`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Billing month-to-date" subtitle="Expected vs overdue" />
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <div className="text-apple-xs uppercase text-apple-text-tertiary">Expected</div>
              <div className="mt-1 text-apple-2xl font-semibold tabular-nums text-apple-text">
                ${(expectedMtd / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div>
              <div className="text-apple-xs uppercase text-apple-text-tertiary">Overdue</div>
              <div className={`mt-1 text-apple-2xl font-semibold tabular-nums ${overdueCnt > 0 ? "text-apple-red" : "text-apple-text"}`}>
                ${(overdueAmt / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              <div className="text-apple-xs text-apple-text-tertiary">{overdueCnt} {overdueCnt === 1 ? "invoice" : "invoices"}</div>
            </div>
          </div>
          <div className="mt-4">
            <Link href={`/admin/locations/${slug}/billing`} className="text-apple-sm font-medium text-apple-blue hover:underline">
              View billing →
            </Link>
          </div>
        </Card>

        <Card>
          <CardHeader title="Quick actions" />
          <div className="mt-4 flex flex-wrap gap-2">
            <QuickAction href={`/admin/locations/${slug}/members/list`} label="View members" />
            <QuickAction href={`/admin/locations/${slug}/members/list?new=1`} label="Add member" />
            <QuickAction href={`/admin/locations/${slug}/scheduling/bookings`} label="Bookings" />
            <QuickAction href={`/admin/locations/${slug}/marketing/messaging`} label="Send message" />
            <QuickAction href={`/admin/locations/${slug}/billing/payments`} label="Payments" />
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Recent notifications"
          action={
            upcomingBookings > 0 && (
              <span className="text-apple-xs text-apple-text-tertiary">
                {upcomingBookings} upcoming booking{upcomingBookings === 1 ? "" : "s"}
              </span>
            )
          }
        />
        <div className="mt-4 space-y-2">
          {recentNotifications.length === 0 ? (
            <p className="text-apple-sm text-apple-text-tertiary">No notifications yet.</p>
          ) : (
            recentNotifications.map((n) => (
              <div key={n.id} className="flex items-start gap-3 rounded-apple-sm border border-apple-divider px-3 py-2.5">
                <span className={`mt-1 h-2 w-2 rounded-full ${
                  n.severity === "ERROR" ? "bg-apple-red" :
                  n.severity === "WARN" ? "bg-apple-orange" : "bg-apple-blue"
                }`} />
                <div className="min-w-0 flex-1">
                  <div className="text-apple-sm font-medium text-apple-text">{n.title}</div>
                  {n.body && <div className="mt-0.5 text-apple-xs text-apple-text-secondary">{n.body}</div>}
                  <div className="mt-1 text-[10px] text-apple-text-tertiary">{new Date(n.createdAt).toLocaleString()}</div>
                </div>
                {n.link && (
                  <Link href={n.link} className="text-apple-xs font-medium text-apple-blue hover:underline">
                    Open
                  </Link>
                )}
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

function KpiCard({ label, value, href }: { label: string; value: string; href?: string }) {
  const inner = (
    <div className="rounded-apple bg-white p-4 shadow-apple transition-shadow hover:shadow-apple-md">
      <div className="text-apple-xs uppercase tracking-wide text-apple-text-tertiary">{label}</div>
      <div className="mt-1 text-apple-2xl font-semibold tabular-nums text-apple-text">{value}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function QuickAction({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center rounded-apple-pill border border-apple-border bg-white px-4 py-2 text-apple-sm font-medium text-apple-text hover:bg-apple-fill-secondary"
    >
      {label}
    </Link>
  );
}
