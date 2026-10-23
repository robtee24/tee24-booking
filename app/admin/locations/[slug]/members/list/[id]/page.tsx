import Link from "next/link";
import { notFound } from "next/navigation";
import { Mail, Phone, MapPin, Calendar, User, Megaphone, CreditCard } from "lucide-react";
import { getMemberDetail } from "@/services/member.service";
import { getPrisma } from "@/lib/db";
import { adminRoutes } from "@/lib/admin/routes";
import { Card, CardHeader, StatusBadge, Money, Badge } from "@/components/ui";
import { TagsEditor, KisiAccessCard, CheckinCodeCard } from "@/components/admin/members/OverviewWidgets";
import { MobileDeviceCard } from "@/components/admin/members/MobileDeviceCard";
import { memberDeviceSummary } from "@/services/mobile-auth.service";
import { ageFromDob, fmtDate, fmtDateTime, genderLabel, relTime } from "@/components/admin/members/format";

export const dynamic = "force-dynamic";

export default async function MemberProfilePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const member = await getMemberDetail(id);
  if (!member || member.location.slug !== slug) notFound();

  const prisma = getPrisma();
  const [recentInvoices, recentVisits, overdue, lastVisit, creditAgg, deviceSummary] = await Promise.all([
    prisma.invoice.findMany({ where: { memberId: id }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.visit.findMany({ where: { memberId: id }, orderBy: { enteredAt: "desc" }, take: 5, include: { bay: { select: { number: true } } } }),
    prisma.invoice.findMany({ where: { memberId: id, status: { in: ["SCHEDULED", "PAST_DUE", "FAILED"] }, dueDate: { lt: new Date() } }, select: { totalCents: true, refundedCents: true } }),
    prisma.visit.findFirst({ where: { memberId: id }, orderBy: { enteredAt: "desc" }, select: { enteredAt: true } }),
    prisma.memberCredit.aggregate({ where: { memberId: id }, _sum: { amountCents: true } }),
    memberDeviceSummary(id),
  ]);
  const overdueCents = overdue.reduce((s, i) => s + (i.totalCents - i.refundedCents), 0);
  const creditBalanceCents = creditAgg._sum.amountCents ?? 0;

  const activeSub = member.membershipSubscriptions.find((s) => ["ACTIVE", "CANCEL_SCHEDULED", "FROZEN", "FREEZE_SCHEDULED", "COMP"].includes(s.status));
  const defaultCard = member.paymentMethods.find((p) => p.isDefault) ?? member.paymentMethods[0];
  const age = ageFromDob(member.dob);
  const secondaryEmails = (member.secondaryEmails as string[] | null) ?? [];
  const secondaryPhones = (member.secondaryPhones as string[] | null) ?? [];
  const address = [member.addressLine1, member.addressLine2, member.city, member.state, member.zip].filter(Boolean).join(", ");
  const familyName = member.family?.family?.name ?? null;
  const familyCount = member.family?.family?.members.length ?? 0;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-1">
        <Card>
          <CardHeader title="Contact" />
          <dl className="mt-4 space-y-3 text-apple-sm">
            <ContactRow icon={<Mail className="h-4 w-4" />} value={<a href={`mailto:${member.email}`} className="hover:underline">{member.email}</a>} />
            {secondaryEmails.map((e) => <ContactRow key={e} icon={<Mail className="h-4 w-4 opacity-40" />} value={<span className="text-apple-text-secondary">{e}</span>} />)}
            <ContactRow icon={<Phone className="h-4 w-4" />} value={<a href={`tel:${member.phone}`} className="hover:underline">{member.phone || "—"}</a>} />
            {secondaryPhones.map((p) => <ContactRow key={p} icon={<Phone className="h-4 w-4 opacity-40" />} value={<span className="text-apple-text-secondary">{p}</span>} />)}
            {member.dob && <ContactRow icon={<Calendar className="h-4 w-4" />} value={`Born ${fmtDate(member.dob)}${age !== null ? ` · ${age} yrs` : ""}`} />}
            {member.guardianName && <ContactRow icon={<User className="h-4 w-4" />} value={`Guardian: ${member.guardianName}`} />}
            {address && <ContactRow icon={<MapPin className="h-4 w-4" />} value={address} />}
            {member.acquisitionSource && <ContactRow icon={<Megaphone className="h-4 w-4" />} value={`Heard about us via ${member.acquisitionSource}`} />}
          </dl>
          <div className="mt-4 flex flex-wrap gap-1.5">
            <Badge tone={member.optInEmailMarketing ? "success" : "muted"} size="sm">Email {member.optInEmailMarketing ? "opt-in" : "opt-out"}</Badge>
            <Badge tone={member.optInSmsMarketing ? "success" : "muted"} size="sm">SMS {member.optInSmsMarketing ? "opt-in" : "opt-out"}</Badge>
            {member.gender && <Badge tone="muted" size="sm">{genderLabel(member.gender)}</Badge>}
          </div>
        </Card>

        <Card>
          <CardHeader title="Membership" action={<Link className="text-apple-xs font-medium text-apple-blue" href={adminRoutes.loc.members.detailTab(slug, id, "memberships")}>Manage →</Link>} />
          <div className="mt-3 space-y-2 text-apple-sm">
            {activeSub ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-apple-text">{activeSub.plan.name}</span>
                  <StatusBadge status={activeSub.status} size="sm" />
                </div>
                <div className="text-apple-text-secondary">
                  <Money cents={activeSub.priceCents} /> / {activeSub.billingCadence.toLowerCase()}
                </div>
                {activeSub.paidThroughDate && <div className="text-apple-xs text-apple-text-tertiary">Paid through {fmtDate(activeSub.paidThroughDate)}</div>}
                {activeSub.nextInvoiceDate && <div className="text-apple-xs text-apple-text-tertiary">Next invoice {fmtDate(activeSub.nextInvoiceDate)}</div>}
              </>
            ) : (
              <div className="space-y-1">
                <p className="text-apple-text-tertiary">No active subscription</p>
                {member.membershipType && (
                  <p className="text-apple-xs text-apple-text-tertiary">Imported plan: {member.membershipType}</p>
                )}
              </div>
            )}
            <div className="flex items-center justify-between border-t border-apple-divider pt-2 text-apple-xs text-apple-text-tertiary">
              <span>Joined {fmtDate(member.joinDate)}</span>
              <span>Last visit {relTime(lastVisit?.enteredAt)}</span>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Billing" action={<Link className="text-apple-xs font-medium text-apple-blue" href={adminRoutes.loc.members.detailTab(slug, id, "payments")}>Payments →</Link>} />
          <div className="mt-3 space-y-2 text-apple-sm">
            <div className="flex items-center gap-2 text-apple-text">
              <CreditCard className="h-4 w-4 text-apple-text-tertiary" />
              {defaultCard ? `${defaultCard.brand ?? "Card"} •••• ${defaultCard.last4}` : <span className="text-apple-text-tertiary">No card on file</span>}
            </div>
            {overdue.length > 0 ? (
              <div className="flex items-center justify-between rounded-apple-sm bg-apple-red/5 px-2 py-1.5 text-apple-red">
                <span>{overdue.length} overdue</span>
                <Money cents={overdueCents} className="font-semibold" />
              </div>
            ) : (
              <div className="text-apple-xs text-apple-green">No overdue balance</div>
            )}
            {creditBalanceCents > 0 && (
              <div className="flex items-center justify-between text-apple-text-secondary">
                <span>Account credit</span>
                <Money cents={creditBalanceCents} />
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Tags" />
          <div className="mt-3">
            <TagsEditor slug={slug} memberId={id} tags={member.memberTags.map((mt) => ({ id: mt.tag.id, name: mt.tag.name, color: mt.tag.color }))} />
          </div>
        </Card>
      </div>

      <div className="space-y-4 lg:col-span-2">
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader title="Door access" subtitle="Kisi" />
            <div className="mt-3">
              <KisiAccessCard memberId={id} enabled={member.kisiAccessEnabled} reason={member.kisiAccessReason} kisiUserId={member.kisiUserId} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Check-in code" subtitle="Front desk kiosk" />
            <div className="mt-3">
              <CheckinCodeCard memberId={id} code={member.checkinCode} />
            </div>
          </Card>
          <Card className="md:col-span-2">
            <CardHeader title="Member app" subtitle="One phone per member" />
            <div className="mt-3">
              <MobileDeviceCard
                memberId={id}
                firstName={member.firstName}
                device={
                  deviceSummary.active
                    ? {
                        id: deviceSummary.active.id,
                        platform: deviceSummary.active.platform,
                        name: deviceSummary.active.name,
                        model: deviceSummary.active.model,
                        osVersion: deviceSummary.active.osVersion,
                        appVersion: deviceSummary.active.appVersion,
                        boundAt: deviceSummary.active.boundAt.toISOString(),
                        lastSeenAt: deviceSummary.active.lastSeenAt?.toISOString() ?? null,
                      }
                    : null
                }
                pendingRequests={deviceSummary.pending.length}
                liveSessions={deviceSummary.liveSessions}
              />
            </div>
          </Card>
        </div>

        <Card>
          <CardHeader title="At a glance" />
          <dl className="mt-3 grid grid-cols-2 gap-3 text-apple-sm sm:grid-cols-4">
            <Stat label="Visits" value={member._count.visits} href={adminRoutes.loc.members.detailTab(slug, id, "attendance")} />
            <Stat label="Invoices" value={member._count.invoices} href={adminRoutes.loc.members.detailTab(slug, id, "payments")} />
            <Stat label="Documents" value={member._count.documentAssignments} href={adminRoutes.loc.members.detailTab(slug, id, "documents")} />
            <Stat label="Messages" value={member._count.messages} href={adminRoutes.loc.members.detailTab(slug, id, "messaging")} />
          </dl>
          {(familyName || familyCount > 0) && (
            <p className="mt-3 text-apple-xs text-apple-text-tertiary">
              Part of family <Link href={adminRoutes.loc.members.detailTab(slug, id, "family")} className="font-medium text-apple-blue hover:underline">{familyName ?? "group"}</Link> ({familyCount} members)
            </p>
          )}
        </Card>

        {member.customFieldValues.length > 0 && (
          <Card>
            <CardHeader title="Custom fields" />
            <dl className="mt-3 grid gap-3 text-apple-sm sm:grid-cols-2">
              {member.customFieldValues.map((v) => (
                <div key={v.id}>
                  <dt className="text-apple-xs uppercase tracking-wide text-apple-text-tertiary">{v.field.name}</dt>
                  <dd className="mt-0.5 text-apple-text">{renderCustomValue(v)}</dd>
                </div>
              ))}
            </dl>
          </Card>
        )}

        <Card>
          <CardHeader title="Recent payments" action={<Link className="text-apple-xs font-medium text-apple-blue" href={adminRoutes.loc.members.detailTab(slug, id, "payments")}>View all →</Link>} />
          {recentInvoices.length === 0 ? (
            <p className="mt-3 text-apple-sm text-apple-text-tertiary">No invoices yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-apple-divider">
              {recentInvoices.map((i) => (
                <li key={i.id} className="flex items-center justify-between py-2 text-apple-sm">
                  <div>
                    <div className="text-apple-text">Invoice #{i.number}</div>
                    <div className="text-apple-xs text-apple-text-tertiary">Due {fmtDate(i.dueDate)}</div>
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
          <CardHeader title="Recent visits" action={<Link className="text-apple-xs font-medium text-apple-blue" href={adminRoutes.loc.members.detailTab(slug, id, "attendance")}>View all →</Link>} />
          {recentVisits.length === 0 ? (
            <p className="mt-3 text-apple-sm text-apple-text-tertiary">No visits recorded yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-apple-divider">
              {recentVisits.map((v) => (
                <li key={v.id} className="flex items-center justify-between py-2 text-apple-sm">
                  <div>
                    <div className="text-apple-text">{fmtDateTime(v.enteredAt)}</div>
                    <div className="text-apple-xs text-apple-text-tertiary">
                      {v.type.replace(/_/g, " ")} · {v.source.replace(/_/g, " ").toLowerCase()} {v.bay ? `· Bay ${v.bay.number}` : ""}
                    </div>
                  </div>
                  {v.unlockCount > 1 && <Badge tone="muted" size="sm">×{v.unlockCount} unlocks</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function renderCustomValue(v: { valueText: string | null; valueNumber: number | null; valueDate: Date | null; valueJson: unknown }): string {
  if (v.valueText) return v.valueText;
  if (v.valueNumber !== null && v.valueNumber !== undefined) return String(v.valueNumber);
  if (v.valueDate) return fmtDate(v.valueDate);
  if (Array.isArray(v.valueJson)) return v.valueJson.join(", ");
  if (typeof v.valueJson === "boolean") return v.valueJson ? "Yes" : "No";
  if (v.valueJson !== null && v.valueJson !== undefined) return String(v.valueJson);
  return "—";
}

function ContactRow({ icon, value }: { icon: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 text-apple-text-tertiary">{icon}</span>
      <span className="min-w-0 break-words text-apple-text">{value}</span>
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="rounded-apple-sm p-1 -m-1 hover:bg-apple-fill-secondary">
      <div className="text-apple-xs uppercase text-apple-text-tertiary">{label}</div>
      <div className="mt-0.5 text-apple-lg font-semibold text-apple-text">{value}</div>
    </Link>
  );
}
