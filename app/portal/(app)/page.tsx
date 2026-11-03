import Link from "next/link";
import { CalendarDays, IdCard, Target, Gift, DoorOpen, Footprints, Trophy, Clock, ArrowRight } from "lucide-react";
import { membershipDisplayName } from "@/lib/membership-pricing";
import { Card, CardHeader, StatusBadge, Money } from "@/components/ui";
import { getCurrentMember } from "@/lib/member-session";
import { getPrisma } from "@/lib/db";
import { getVisitAllowance } from "@/services/visit-allowance.service";

export const dynamic = "force-dynamic";

function greeting(tz: string) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(new Date()));
  if (hour < 5) return "Burning the midnight oil";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const TAGLINES = [
  "The bays are open 24/7 — your tee time is whenever you want it.",
  "Every swing counts. Let's go hit some.",
  "Rain or shine, it's always golf weather in here.",
  "Your next round is a tap away.",
  "Grip it and rip it — the sim is ready when you are.",
];

export default async function PortalHome() {
  const member = await getCurrentMember();
  if (!member) return null;
  const prisma = getPrisma();
  const now = new Date();

  const [sub, loc, allowance, nextBooking] = await Promise.all([
    prisma.membershipSubscription.findFirst({
      where: { memberId: member.id, status: { in: ["ACTIVE", "CANCEL_SCHEDULED", "FROZEN", "COMP"] } },
      include: { plan: true },
      orderBy: { startDate: "desc" },
    }),
    member.location ? prisma.location.findUnique({ where: { id: member.location.id }, select: { timezone: true } }) : null,
    getVisitAllowance(member.id).catch(() => null),
    prisma.booking.findFirst({
      where: { OR: [{ memberId: member.id }, { email: member.email }], start: { gte: now }, canceledAt: null },
      orderBy: { start: "asc" },
      select: { id: true, start: true, bayNumber: true, managementToken: true, Location: { select: { name: true, timezone: true } } },
    }),
  ]);

  const tz = loc?.timezone ?? "America/New_York";
  const tagline = TAGLINES[(member.id.charCodeAt(0) + now.getDate()) % TAGLINES.length];
  const memberSince = member.joinDate ?? member.membershipStartDate ?? member.createdAt;
  const memberSinceLabel = memberSince ? new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(new Date(memberSince)) : null;
  const planLabel = sub ? membershipDisplayName(sub.plan.name, sub.guestCount, sub.plan.productType) : null;
  const doorReady = member.kisiAccessEnabled && (allowance?.canUnlock ?? true);

  const nextLabel = nextBooking
    ? new Intl.DateTimeFormat("en-US", { timeZone: nextBooking.Location?.timezone ?? tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(nextBooking.start)
    : null;

  const quickActions = [
    { href: "/portal/schedule", label: "Book a bay", hint: "Reserve your next round", icon: CalendarDays, tone: "bg-[#0b3d2e] text-white hover:bg-[#0f5a3f]" },
    { href: "/portal/card", label: "Member card", hint: "Door access & QR", icon: IdCard, tone: "bg-white text-apple-text ring-1 ring-apple-border hover:ring-[#22c55e]" },
    { href: "/portal/swing", label: "Swing Lab", hint: "Review your swings", icon: Target, tone: "bg-white text-apple-text ring-1 ring-apple-border hover:ring-[#22c55e]" },
    { href: "/portal/membership", label: "Membership", hint: "Plan, family & guests", icon: Trophy, tone: "bg-white text-apple-text ring-1 ring-apple-border hover:ring-[#22c55e]" },
  ];

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-apple bg-gradient-to-br from-[#0b3d2e] via-[#0f5a3f] to-[#1b7a4f] p-6 text-white shadow-apple sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-28 -left-16 h-64 w-64 rounded-full bg-black/10" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/tee24-mark.png" alt="" aria-hidden className="pointer-events-none absolute -right-6 bottom-0 hidden h-44 w-auto opacity-20 sm:block" />
        <div className="relative">
          <p className="text-apple-sm font-medium text-white/70">{greeting(tz)},</p>
          <h1 className="mt-0.5 text-apple-3xl font-semibold tracking-tight sm:text-apple-hero">{member.firstName} ⛳</h1>
          <p className="mt-2 max-w-md text-apple-base text-white/80">{tagline}</p>
          <div className="mt-5 flex flex-wrap items-center gap-2 text-apple-xs">
            {planLabel && (
              <span className="inline-flex items-center gap-1.5 rounded-apple-pill bg-white/15 px-3 py-1 font-semibold">
                <Trophy className="h-3.5 w-3.5" /> {planLabel}
              </span>
            )}
            {memberSinceLabel && <span className="rounded-apple-pill bg-white/15 px-3 py-1 font-medium text-white/90">Member since {memberSinceLabel}</span>}
            {member.location?.name && <span className="rounded-apple-pill bg-white/15 px-3 py-1 font-medium text-white/90">Home: {member.location.name}</span>}
          </div>
        </div>
      </section>

      {/* Quick actions */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {quickActions.map((a) => (
          <Link key={a.href} href={a.href} className={`group flex flex-col gap-3 rounded-apple p-4 shadow-apple transition-all ${a.tone}`}>
            <a.icon className="h-6 w-6" />
            <div>
              <div className="flex items-center gap-1 font-semibold">
                {a.label}
                <ArrowRight className="h-4 w-4 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
              </div>
              <div className="text-apple-xs opacity-70">{a.hint}</div>
            </div>
          </Link>
        ))}
      </section>

      {/* Stats */}
      <section className="grid gap-3 sm:grid-cols-3">
        <Card className="flex items-center gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#22c55e]/15 text-[#0b3d2e]"><Footprints className="h-5 w-5" /></span>
          <div className="min-w-0">
            <div className="text-apple-xs font-medium uppercase tracking-wide text-apple-text-tertiary">Rounds this period</div>
            <div className="text-apple-xl font-semibold text-apple-text">
              {allowance ? (allowance.unlimited ? `${allowance.used}` : `${allowance.used} / ${allowance.limit ?? "—"}`) : "—"}
              {allowance?.unlimited && <span className="ml-1.5 text-apple-xs font-medium text-[#16a34a]">unlimited</span>}
            </div>
            {allowance?.periodLabel && <div className="text-apple-xs text-apple-text-tertiary">{allowance.periodLabel}</div>}
          </div>
        </Card>
        <Card className="flex items-center gap-4">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${doorReady ? "bg-[#22c55e]/15 text-[#0b3d2e]" : "bg-apple-red/10 text-apple-red"}`}><DoorOpen className="h-5 w-5" /></span>
          <div className="min-w-0">
            <div className="text-apple-xs font-medium uppercase tracking-wide text-apple-text-tertiary">Door access</div>
            <div className="text-apple-xl font-semibold text-apple-text">{doorReady ? "Ready" : "Paused"}</div>
            <div className="truncate text-apple-xs text-apple-text-tertiary">
              {doorReady ? "Unlock from the Tee24 app" : allowance?.blockedReason ?? member.kisiAccessReason ?? "Contact us for help"}
            </div>
          </div>
        </Card>
        <Card className="flex items-center gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#22c55e]/15 text-[#0b3d2e]"><Clock className="h-5 w-5" /></span>
          <div className="min-w-0">
            <div className="text-apple-xs font-medium uppercase tracking-wide text-apple-text-tertiary">Next tee time</div>
            {nextBooking ? (
              <>
                <div className="text-apple-base font-semibold leading-tight text-apple-text">{nextLabel}</div>
                <div className="text-apple-xs text-apple-text-tertiary">
                  Bay {nextBooking.bayNumber}{nextBooking.Location?.name ? ` · ${nextBooking.Location.name}` : ""} ·{" "}
                  <a href={`/manage/${nextBooking.id}?token=${encodeURIComponent(nextBooking.managementToken)}`} className="text-[#16a34a] hover:underline">Manage</a>
                </div>
              </>
            ) : (
              <>
                <div className="text-apple-base font-semibold leading-tight text-apple-text">Nothing booked</div>
                <Link href="/portal/schedule" className="text-apple-xs text-[#16a34a] hover:underline">Grab a bay →</Link>
              </>
            )}
          </div>
        </Card>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Your membership" action={<Link href="/portal/membership" className="text-apple-sm font-medium text-[#16a34a] hover:underline">Manage</Link>} />
          {sub ? (
            <>
              <div className="mt-3 flex items-center justify-between">
                <span className="font-medium text-apple-text">{planLabel}</span>
                <StatusBadge status={sub.status} size="sm" />
              </div>
              <div className="mt-1 text-apple-sm text-apple-text-secondary"><Money cents={sub.priceCents} /> / {sub.billingCadence.toLowerCase()}</div>
              {sub.paidThroughDate && (
                <div className="mt-1 text-apple-xs text-apple-text-tertiary">Paid through {new Date(sub.paidThroughDate).toLocaleDateString()}</div>
              )}
              <p className="mt-3 text-apple-xs text-apple-text-tertiary">Add a family member for 50% off, or bring guests for $25/mo each.</p>
            </>
          ) : (
            <p className="mt-3 text-apple-sm text-apple-text-tertiary">You don&apos;t have an active membership yet.</p>
          )}
        </Card>

        <Card className="relative overflow-hidden">
          <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[#22c55e]/10" />
          <CardHeader title="Bring a buddy" subtitle="Share your code — friends who join give you both a boost." />
          {member.referralCode ? (
            <div className="mt-3 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#22c55e]/15 text-[#0b3d2e]"><Gift className="h-5 w-5" /></span>
              <code className="rounded-apple-sm bg-[#f3f7f4] px-3 py-1.5 font-mono text-apple-lg font-semibold tracking-wider text-[#0b3d2e]">{member.referralCode}</code>
            </div>
          ) : (
            <p className="mt-3 text-apple-sm text-apple-text-tertiary">Referral program coming soon.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
