import Link from "next/link";
import { notFound } from "next/navigation";
import { getMemberDetail } from "@/services/member.service";
import { getPrisma } from "@/lib/db";
import { Card, CardHeader, PageHeader, StatusBadge, Money, Badge } from "@/components/ui";
import { ArrowLeft, Mail, Phone, MapPin, Calendar, Eye, MoreVertical } from "lucide-react";
import { ProfileTabs } from "./ProfileTabs";

export const dynamic = "force-dynamic";

export default async function MemberProfilePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const member = await getMemberDetail(id);
  if (!member) notFound();

  const prisma = getPrisma();
  const [recentInvoices, recentVisits, latestUsageTier] = await Promise.all([
    prisma.invoice.findMany({
      where: { memberId: id },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.visit.findMany({
      where: { memberId: id },
      orderBy: { enteredAt: "desc" },
      take: 5,
      include: { bay: { select: { number: true } } },
    }),
    prisma.usageTierSnapshot.findFirst({ where: { memberId: id }, orderBy: { computedAt: "desc" } }),
  ]);

  const activeSub = member.membershipSubscriptions.find((s: any) => s.status === "ACTIVE" || s.status === "CANCEL_SCHEDULED" || s.status === "FROZEN");

  return (
    <div className="space-y-6">
      <Link href={`/admin/locations/${slug}/members/list`} className="inline-flex items-center gap-1 text-apple-sm text-apple-text-secondary hover:text-apple-text">
        <ArrowLeft className="h-4 w-4" />
        Back to members
      </Link>

      <PageHeader
        title={`${member.firstName} ${member.lastName}`}
        meta={
          <>
            <StatusBadge status={member.status} />
            {latestUsageTier && <StatusBadge status={latestUsageTier.tier} />}
            {member.kisiAccessEnabled ? (
              <Badge tone="success">Door access enabled</Badge>
            ) : (
              <Badge tone="warn">Door access disabled</Badge>
            )}
          </>
        }
        actions={
          <>
            <Link href={`/portal?as=${member.id}`} className="inline-flex items-center gap-1 rounded-apple-pill border border-apple-red/30 bg-apple-red/5 px-4 py-2 text-apple-sm font-medium text-apple-red hover:bg-apple-red/10">
              <Eye className="h-4 w-4" />
              View as member
            </Link>
            <button className="rounded-apple-sm border border-apple-border bg-white p-2 text-apple-text hover:bg-apple-fill-secondary">
              <MoreVertical className="h-4 w-4" />
            </button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          <Card>
            <CardHeader title="Contact" />
            <dl className="mt-4 space-y-3 text-apple-sm">
              <ContactRow icon={<Mail className="h-4 w-4" />} value={member.email} />
              <ContactRow icon={<Phone className="h-4 w-4" />} value={member.phone} />
              {member.dob && <ContactRow icon={<Calendar className="h-4 w-4" />} value={`Born ${new Date(member.dob).toLocaleDateString()}`} />}
              {(member.addressLine1 || member.city) && (
                <ContactRow
                  icon={<MapPin className="h-4 w-4" />}
                  value={[member.addressLine1, member.addressLine2, member.city, member.state, member.zip].filter(Boolean).join(", ")}
                />
              )}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Membership" />
            <div className="mt-3 space-y-2 text-apple-sm">
              {activeSub ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-apple-text">{activeSub.plan.name}</span>
                    <StatusBadge status={activeSub.status} size="sm" />
                  </div>
                  <div className="text-apple-text-secondary">
                    <Money cents={activeSub.priceCents} /> / {activeSub.billingCadence.toLowerCase()}
                  </div>
                  {activeSub.paidThroughDate && (
                    <div className="text-apple-xs text-apple-text-tertiary">
                      Paid through {new Date(activeSub.paidThroughDate).toLocaleDateString()}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-apple-text-tertiary">No active membership</p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Tags" />
            <div className="mt-3 flex flex-wrap gap-1.5">
              {member.memberTags.length === 0 && (
                <p className="text-apple-sm text-apple-text-tertiary">No tags</p>
              )}
              {member.memberTags.map((mt: any) => (
                <span
                  key={mt.tag.id}
                  className="rounded-full px-2 py-0.5 text-apple-xs"
                  style={{ backgroundColor: (mt.tag.color ?? "#16a34a") + "20", color: mt.tag.color ?? "#16a34a" }}
                >
                  {mt.tag.name}
                </span>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="At a glance" />
            <dl className="mt-3 grid grid-cols-2 gap-3 text-apple-sm">
              <Stat label="Visits" value={member._count.visits} />
              <Stat label="Invoices" value={member._count.invoices} />
              <Stat label="Documents" value={member._count.documentAssignments} />
              <Stat label="Messages" value={member._count.messages} />
            </dl>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <ProfileTabs slug={slug} memberId={id} />

          <Card>
            <CardHeader title="Recent payments" action={<Link className="text-apple-xs font-medium text-apple-blue" href={`/admin/locations/${slug}/billing/payments?memberId=${id}`}>View all →</Link>} />
            {recentInvoices.length === 0 ? (
              <p className="mt-3 text-apple-sm text-apple-text-tertiary">No invoices yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-apple-divider">
                {recentInvoices.map((i) => (
                  <li key={i.id} className="flex items-center justify-between py-2 text-apple-sm">
                    <div>
                      <div className="text-apple-text">Invoice #{i.number}</div>
                      <div className="text-apple-xs text-apple-text-tertiary">
                        Due {new Date(i.dueDate).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Money cents={i.totalCents} className="font-medium" />
                      <StatusBadge status={i.status} size="sm" />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Recent visits" action={<Link className="text-apple-xs font-medium text-apple-blue" href={`/admin/locations/${slug}/members/attendance?memberId=${id}`}>View all →</Link>} />
            {recentVisits.length === 0 ? (
              <p className="mt-3 text-apple-sm text-apple-text-tertiary">No visits recorded yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-apple-divider">
                {recentVisits.map((v) => (
                  <li key={v.id} className="flex items-center justify-between py-2 text-apple-sm">
                    <div>
                      <div className="text-apple-text">{new Date(v.enteredAt).toLocaleString()}</div>
                      <div className="text-apple-xs text-apple-text-tertiary">
                        {v.type.replace("_", " ")} {v.bay ? `· Bay ${v.bay.number}` : ""}
                      </div>
                    </div>
                    {v.unlockCount > 1 && (
                      <Badge tone="muted" size="sm">×{v.unlockCount} unlocks</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function ContactRow({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 text-apple-text-tertiary">{icon}</span>
      <span className="min-w-0 break-words text-apple-text">{value}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-apple-xs uppercase text-apple-text-tertiary">{label}</div>
      <div className="mt-0.5 text-apple-lg font-semibold text-apple-text">{value}</div>
    </div>
  );
}
