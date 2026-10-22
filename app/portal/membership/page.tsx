import Link from "next/link";
import { Card, CardHeader, Money, StatusBadge } from "@/components/ui";
import { getCurrentMember, getMemberSession } from "@/lib/member-session";
import { getMembershipOverview } from "@/services/portal.service";
import { PortalSubNav } from "@/components/portal/PortalSubNav";
import { MembershipActions, RenewBanner } from "./MembershipClient";

export const dynamic = "force-dynamic";

export default async function PortalMembershipPage() {
  const [member, session] = await Promise.all([getCurrentMember(), getMemberSession()]);
  if (!member) return null;
  const { sub, openInvoice, lastPaid, history, plans } = await getMembershipOverview(member.id);
  const canRequest = session?.role !== "IMPERSONATED";

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-apple-2xl font-semibold tracking-tight">Membership</h1>
        <PortalSubNav />
      </div>

      {openInvoice && <RenewBanner payToken={openInvoice.payToken} totalCents={openInvoice.totalCents} dueDate={openInvoice.dueDate.toISOString()} status={openInvoice.status} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Your plan" />
          {sub ? (
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-apple-lg font-semibold text-apple-text">{sub.plan.name}</div>
                  {sub.plan.description && <div className="text-apple-sm text-apple-text-secondary">{sub.plan.description}</div>}
                </div>
                <StatusBadge status={sub.status} size="sm" />
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-apple-sm">
                <dt className="text-apple-text-secondary">Price</dt>
                <dd className="text-right"><Money cents={sub.priceCents} /> / {sub.billingCadence.toLowerCase()}</dd>
                <dt className="text-apple-text-secondary">Started</dt>
                <dd className="text-right">{sub.startDate.toLocaleDateString()}</dd>
                {sub.paidThroughDate && (
                  <>
                    <dt className="text-apple-text-secondary">Paid through</dt>
                    <dd className="text-right">{sub.paidThroughDate.toLocaleDateString()}</dd>
                  </>
                )}
                {sub.nextInvoiceDate && sub.status === "ACTIVE" && (
                  <>
                    <dt className="text-apple-text-secondary">Next invoice</dt>
                    <dd className="text-right">{sub.nextInvoiceDate.toLocaleDateString()}</dd>
                  </>
                )}
                {sub.cancelScheduledFor && (
                  <>
                    <dt className="text-apple-text-secondary">Ends</dt>
                    <dd className="text-right text-apple-red">{sub.cancelScheduledFor.toLocaleDateString()}</dd>
                  </>
                )}
                {sub.status === "FROZEN" && sub.freezeResumeDate && (
                  <>
                    <dt className="text-apple-text-secondary">Resumes</dt>
                    <dd className="text-right">{sub.freezeResumeDate.toLocaleDateString()}</dd>
                  </>
                )}
                {sub.cancelRequestedAt && !sub.cancelledAt && (
                  <>
                    <dt className="text-apple-text-secondary">Cancellation requested</dt>
                    <dd className="text-right">{sub.cancelRequestedAt.toLocaleDateString()}</dd>
                  </>
                )}
              </dl>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-apple-sm text-apple-text-tertiary">You don&apos;t have an active membership.</p>
              <Link href="/portal/contact" className="inline-block text-apple-sm font-medium text-apple-blue hover:underline">Ask us about joining →</Link>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Billing" />
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-apple-sm">
            <dt className="text-apple-text-secondary">Last payment</dt>
            <dd className="text-right">{lastPaid?.paidAt ? <><Money cents={lastPaid.totalCents} /> · {lastPaid.paidAt.toLocaleDateString()}</> : "—"}</dd>
            <dt className="text-apple-text-secondary">Next due</dt>
            <dd className="text-right">{openInvoice ? <><Money cents={openInvoice.totalCents} /> · {openInvoice.dueDate.toLocaleDateString()}</> : "Nothing scheduled"}</dd>
          </dl>
          <div className="mt-4 flex flex-wrap gap-3 text-apple-sm font-medium">
            <Link href="/portal/billing" className="text-apple-blue hover:underline">Payment history & cards →</Link>
          </div>
        </Card>
      </div>

      {sub && (
        <MembershipActions
          canRequest={canRequest}
          cancelPending={!!sub.cancelRequestedAt && !sub.cancelledAt}
          currentPlanId={sub.plan.id}
          plans={plans}
          frozen={sub.status === "FROZEN"}
        />
      )}

      {history.length > 1 && (
        <Card>
          <CardHeader title="History" />
          <ul className="mt-3 divide-y divide-apple-divider text-apple-sm">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between py-2">
                <span className="text-apple-text">{h.plan.name}</span>
                <span className="text-apple-text-tertiary">
                  {h.startDate.toLocaleDateString()}{h.endDate ? ` – ${h.endDate.toLocaleDateString()}` : ""} · <StatusBadge status={h.status} size="sm" />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
