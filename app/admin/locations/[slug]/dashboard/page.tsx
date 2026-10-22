import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { AreaChart, DonutChart, KpiCard } from "@/components/ui/charts";
import { getPrisma } from "@/lib/db";
import { getCurrentAdmin } from "@/lib/access";
import { adminRoutes } from "@/lib/admin/routes";
import { memberStatusBreakdown, visitsByDay, revenueByMonth } from "@/lib/chart-data";
import {
  getAttentionList,
  getOverdueInvoices,
  getPaymentsThisMonth,
  getTodayReservations,
  type AttentionItem,
} from "@/services/dashboard.service";
import { AttentionList, RecentNotifications, TasksWidget } from "./DashboardWidgets";
import { CalendarClock, ChevronRight } from "lucide-react";

export const dynamic = "force-dynamic";

const usd = (cents: number, digits = 0) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export default async function LocationDashboard({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: raw } = await params;
  const slug = decodeURIComponent(raw);
  const prisma = getPrisma();
  const [location, admin] = await Promise.all([
    prisma.location.findUnique({ where: { slug }, select: { id: true, name: true, slug: true, timezone: true } }),
    getCurrentAdmin(),
  ]);
  if (!location || !admin) notFound();

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [
    activeMembers,
    visitorsCount,
    frozenMembers,
    visitsToday,
    payments,
    reservations,
    attention,
    overdue,
    recentNotifications,
    visits7d,
    visits30d,
    statusBreakdown,
    revenue6mo,
  ] = await Promise.all([
    // Every widget query is isolated so one failure doesn't take the page down.
    safe(() => prisma.member.count({ where: { locationId: location.id, status: "ACTIVE" } }), 0),
    safe(() => prisma.member.count({ where: { locationId: location.id, status: "VISITOR" } }), 0),
    safe(() => prisma.member.count({ where: { locationId: location.id, status: "FROZEN" } }), 0),
    safe(() => prisma.visit.count({ where: { locationId: location.id, enteredAt: { gte: todayStart } } }), 0),
    safe(() => getPaymentsThisMonth(location.id, now), null),
    safe(() => getTodayReservations(location.id, { limit: 8, now }), { rows: [], totalToday: 0 }),
    safe(() => getAttentionList({ locationId: location.id, locationSlug: slug, now }), { items: [] as AttentionItem[], dismissedCount: 0 }),
    safe(() => getOverdueInvoices(location.id, 6), { rows: [], totalCents: 0, count: 0 }),
    safe(
      () =>
        prisma.adminNotification.findMany({
          where: { locationId: location.id, kind: { not: "alert.dismissed" } },
          orderBy: { createdAt: "desc" },
          take: 6,
          select: { id: true, title: true, body: true, link: true, severity: true, readAt: true, createdAt: true },
        }),
      [],
    ),
    safe(() => visitsByDay({ locationId: location.id, days: 7 }), []),
    safe(() => visitsByDay({ locationId: location.id, days: 30 }), []),
    safe(() => memberStatusBreakdown({ locationId: location.id }), []),
    safe(() => revenueByMonth({ locationId: location.id, months: 6 }), []),
  ]);

  const visitsTrend = visits7d.map((v) => ({ y: v.visits }));
  const revenueTrend = revenue6mo.map((m) => ({ y: m.revenue }));
  const maxVisits = Math.max(1, ...visits7d.map((v) => v.visits));
  const errorCount = attention.items.filter((i) => i.severity === "ERROR").length;

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

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Active members" value={activeMembers.toLocaleString()} href={adminRoutes.loc.members.list(slug)} hint={frozenMembers ? `${frozenMembers} frozen` : undefined} />
        <KpiCard label="Visitors" value={visitorsCount.toLocaleString()} href={adminRoutes.loc.marketing.visitors(slug)} />
        <KpiCard label="Visits today" value={visitsToday.toLocaleString()} trend={visitsTrend} href={adminRoutes.loc.members.attendance(slug)} />
        <KpiCard
          label="Needs attention"
          value={attention.items.length.toLocaleString()}
          hint={errorCount > 0 ? `${errorCount} urgent` : attention.items.length ? "Review below" : "All clear"}
          href="#attention"
        />
      </div>

      {/* Payments this month */}
      <Card>
        <CardHeader
          title="Payments this month"
          subtitle={payments ? `${payments.monthStart.toLocaleDateString(undefined, { month: "long" })} · by invoice status` : "Unavailable"}
          action={<Link href={adminRoutes.loc.billing.payments(slug)} className="text-apple-sm font-medium text-apple-blue hover:underline">All payments →</Link>}
        />
        {payments && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MoneyTile label="Paid" tone="success" cents={payments.paid.cents} count={payments.paid.count} href={`${adminRoutes.loc.billing.payments(slug)}?status=PAID`} />
            <MoneyTile label="Scheduled" tone="info" cents={payments.scheduled.cents} count={payments.scheduled.count} href={`${adminRoutes.loc.billing.payments(slug)}?status=SCHEDULED`} />
            <MoneyTile label="Overdue" tone="danger" cents={payments.overdue.cents} count={payments.overdue.count} href={`${adminRoutes.loc.billing.payments(slug)}?status=OVERDUE`} />
          </div>
        )}
      </Card>

      {/* Attention + today's reservations */}
      <div id="attention" className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <AttentionList
            slug={slug}
            dismissedCount={attention.dismissedCount}
            items={attention.items.map((i) => ({ key: i.key, kind: i.kind, severity: i.severity, title: i.title, detail: i.detail, memberId: i.memberId, memberName: i.memberName, href: i.href }))}
          />
        </div>
        <Card padded={false} className="lg:col-span-2">
          <CardHeader
            title="Today's reservations"
            subtitle={`${reservations.totalToday} booked today · next ${reservations.rows.length}`}
            className="p-5 pb-3"
            action={<Link href={adminRoutes.loc.scheduling.bookings(slug)} className="text-apple-xs font-medium text-apple-blue hover:underline">Schedule →</Link>}
          />
          {reservations.rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-5 py-10 text-center text-apple-sm text-apple-text-tertiary">
              <CalendarClock className="h-6 w-6" />
              Nothing else on the books today.
            </div>
          ) : (
            <ol className="relative divide-y divide-apple-divider">
              {reservations.rows.map((r) => (
                <li key={r.id}>
                  <Link href={`${adminRoutes.loc.scheduling.bookings(slug)}?date=${r.start.toISOString().slice(0, 10)}&bay=${r.bayNumber}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-apple-fill-secondary/60">
                    <div className="w-16 shrink-0 text-apple-sm tabular-nums text-apple-text">
                      {r.start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    </div>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${r.status === "in-progress" ? "bg-apple-green" : r.checkedInAt ? "bg-apple-blue" : "bg-apple-border"}`} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-apple-sm font-medium text-apple-text">{r.name}</div>
                      <div className="text-apple-xs text-apple-text-tertiary">
                        Bay {r.bayNumber} · {Math.round((r.end.getTime() - r.start.getTime()) / 60000)} min
                        {r.status === "in-progress" ? " · in progress" : r.checkedInAt ? " · checked in" : ""}
                      </div>
                    </div>
                    {r.memberId && <Badge tone="info" size="sm">Member</Badge>}
                    <ChevronRight className="h-4 w-4 text-apple-text-tertiary" />
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {/* Visits 7d bars + tasks + notifications */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Visits — last 7 days" subtitle="Click a day to open attendance" />
          <div className="mt-4 flex h-40 items-end gap-2">
            {visits7d.map((d) => {
              const iso = d.date;
              const h = Math.max(4, Math.round((d.visits / maxVisits) * 100));
              return (
                <Link
                  key={iso}
                  href={`${adminRoutes.loc.members.attendance(slug)}?from=${iso}&to=${iso}`}
                  className="group flex h-full flex-1 flex-col items-center justify-end gap-1"
                  title={`${d.visits} visit${d.visits === 1 ? "" : "s"} on ${iso}`}
                >
                  <span className="text-[10px] tabular-nums text-apple-text-tertiary opacity-0 transition-opacity group-hover:opacity-100">{d.visits}</span>
                  <span className="w-full rounded-t-apple-sm bg-apple-blue/70 transition-colors group-hover:bg-apple-blue" style={{ height: `${h}%` }} />
                  <span className="text-[10px] text-apple-text-tertiary">{d.label}</span>
                </Link>
              );
            })}
          </div>
          <div className="mt-3 text-right">
            <Link href={`${adminRoutes.loc.members.attendance(slug)}?from=${visits7d[0]?.date ?? ""}&to=${visits7d[visits7d.length - 1]?.date ?? ""}`} className="text-apple-xs font-medium text-apple-blue hover:underline">
              Attendance for this week →
            </Link>
          </div>
        </Card>
        <TasksWidget slug={slug} />
        <RecentNotifications items={recentNotifications.map((n) => ({ ...n, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() }))} />
      </div>

      {/* Overdue invoices + revenue/trend */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card padded={false}>
          <CardHeader
            title="Overdue invoices"
            subtitle={overdue.count ? `${overdue.count} · ${usd(overdue.totalCents, 2)} outstanding` : "Nothing overdue"}
            className="p-5 pb-3"
            action={<Link href={`${adminRoutes.loc.billing.payments(slug)}?status=OVERDUE`} className="text-apple-xs font-medium text-apple-blue hover:underline">View all →</Link>}
          />
          {overdue.rows.length > 0 && (
            <ul className="divide-y divide-apple-divider">
              {overdue.rows.map((inv) => (
                <li key={inv.id}>
                  <Link href={adminRoutes.loc.members.detailTab(slug, inv.member.id, "payments")} className="flex items-center gap-3 px-5 py-2.5 hover:bg-apple-fill-secondary/60">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-apple-sm font-medium text-apple-text">{inv.member.firstName} {inv.member.lastName}</div>
                      <div className="text-apple-xs text-apple-text-tertiary">
                        #{inv.number} · due {inv.dueDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {inv.status === "FAILED" ? "failed" : "past due"}
                      </div>
                    </div>
                    <div className="text-apple-sm font-semibold tabular-nums text-apple-red">{usd(inv.totalCents, 2)}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Member status" subtitle={`${activeMembers + visitorsCount + frozenMembers} total`} />
          <div className="mt-2">
            <DonutChart data={statusBreakdown} useStatusColors centerLabel="Members" centerValue={(activeMembers + visitorsCount + frozenMembers).toLocaleString()} height={200} />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Visits — last 30 days" subtitle="Daily check-ins" />
          <div className="mt-4">
            <AreaChart data={visits30d} xKey="label" series={[{ key: "visits", label: "Visits" }]} height={200} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Revenue trend" subtitle="Last 6 months (paid charges)" action={<KpiMini value={revenueTrend.length ? usd(revenueTrend[revenueTrend.length - 1]!.y) : "—"} />} />
          <div className="mt-4">
            <AreaChart data={revenue6mo} xKey="month" series={[{ key: "revenue", label: "Revenue" }]} height={200} yFormat="currency" />
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Quick actions" />
        <div className="mt-4 flex flex-wrap gap-2">
          <QuickAction href={adminRoutes.loc.members.list(slug)} label="View members" />
          <QuickAction href={adminRoutes.loc.members.new(slug)} label="Add member" />
          <QuickAction href={adminRoutes.loc.scheduling.bookings(slug)} label="Bookings" />
          <QuickAction href={adminRoutes.loc.marketing.messaging(slug)} label="Send message" />
          <QuickAction href={adminRoutes.loc.billing.payments(slug)} label="Payments" />
          <QuickAction href={adminRoutes.loc.frontDesk(slug)} label="Front desk" />
        </div>
      </Card>
    </div>
  );
}

function MoneyTile({ label, tone, cents, count, href }: { label: string; tone: "success" | "info" | "danger"; cents: number; count: number; href: string }) {
  const color = tone === "success" ? "text-apple-green" : tone === "danger" ? (count > 0 ? "text-apple-red" : "text-apple-text") : "text-apple-text";
  return (
    <Link href={href} className="rounded-apple-sm border border-apple-divider p-4 transition-colors hover:bg-apple-fill-secondary/60">
      <div className="flex items-center justify-between">
        <span className="text-apple-xs uppercase tracking-wider text-apple-text-tertiary">{label}</span>
        <Badge tone={tone === "danger" && count === 0 ? "muted" : tone} size="sm">{count} {count === 1 ? "invoice" : "invoices"}</Badge>
      </div>
      <div className={`mt-1 text-apple-2xl font-semibold tabular-nums ${color}`}>{usd(cents, 2)}</div>
    </Link>
  );
}

function KpiMini({ value }: { value: string }) {
  return <span className="text-apple-sm font-semibold tabular-nums text-apple-text">{value}</span>;
}

/** Run a dashboard query; on failure log and return the fallback. */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error("[dashboard] widget query failed:", err instanceof Error ? err.message : err);
    return fallback;
  }
}

function QuickAction({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center rounded-apple-pill border border-apple-border bg-white px-4 py-2 text-apple-sm font-medium text-apple-text hover:bg-apple-fill-secondary">
      {label}
    </Link>
  );
}
