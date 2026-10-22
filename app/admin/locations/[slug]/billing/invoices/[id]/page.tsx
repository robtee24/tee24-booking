import Link from "next/link";
import { notFound } from "next/navigation";
import { getPrisma } from "@/lib/db";
import { Card, CardHeader, Money, PageHeader, StatusBadge } from "@/components/ui";
import { adminRoutes } from "@/lib/admin/routes";
import { getSquarePublicConfig } from "@/lib/square";
import { ensurePayToken, getCreditBalanceCents, listPaymentMethods, publicPayUrl } from "@/services/billing.service";
import { InvoiceActions } from "@/components/admin/billing/InvoiceActions";
import { SquareConnectCallout } from "@/components/admin/billing/SquareConnectCallout";
import { squareStatusPayload } from "@/app/api/admin/billing/_shared";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      member: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true } },
      subscription: { include: { plan: { select: { id: true, name: true, billingCadence: true } } } },
      lineItems: { orderBy: { sortOrder: "asc" } },
      charges: { orderBy: { createdAt: "asc" }, include: { paymentMethod: { select: { brand: true, last4: true } }, refunds: { orderBy: { createdAt: "asc" } } } },
    },
  });
  if (!invoice || invoice.locationId !== location.id) notFound();

  const [payToken, paymentMethods, creditBalanceCents, auditRows, discountApplications] = await Promise.all([
    ensurePayToken(invoice.id).catch(() => null),
    listPaymentMethods(invoice.memberId),
    getCreditBalanceCents(invoice.memberId),
    prisma.auditLog.findMany({ where: { entityType: "Invoice", entityId: invoice.id }, orderBy: { createdAt: "desc" }, take: 30, include: { actor: { select: { name: true, email: true } } } }).catch(() => []),
    prisma.discountApplication.findMany({ where: { invoiceId: invoice.id }, include: { discount: { select: { code: true, name: true } } } }),
  ]);

  const square = getSquarePublicConfig();
  const remaining = invoice.totalCents - invoice.refundedCents;
  const isOpen = ["SCHEDULED", "PAST_DUE", "FAILED"].includes(invoice.status);

  // Timeline: created → charges → refunds → paid/written off, plus audit rows
  type Ev = { at: Date; title: string; detail?: string; tone?: "ok" | "bad" | "muted" };
  const events: Ev[] = [{ at: invoice.createdAt, title: "Invoice created", detail: invoice.description ?? undefined, tone: "muted" }];
  for (const c of invoice.charges) {
    events.push({
      at: c.createdAt,
      title: c.status === "SUCCEEDED" || c.status === "REFUNDED" || c.status === "PARTIALLY_REFUNDED" ? `Payment of ${fmt(c.amountCents, location.currency)} succeeded` : c.status === "FAILED" ? `Payment attempt #${c.attempt} failed` : `Payment ${c.status.toLowerCase()}`,
      detail: [c.paymentMethod ? `${c.paymentMethod.brand} •••• ${c.paymentMethod.last4}` : c.squarePaymentId ? "Card" : c.idempotencyKey?.startsWith("manual_") ? "Offline payment" : null, c.failureReason, c.squarePaymentId].filter(Boolean).join(" · ") || undefined,
      tone: c.status === "FAILED" ? "bad" : "ok",
    });
    for (const r of c.refunds) events.push({ at: r.createdAt, title: `Refund of ${fmt(r.amountCents, location.currency)} ${r.status.toLowerCase()}`, detail: r.reason ?? undefined, tone: "muted" });
  }
  if (invoice.paidAt) events.push({ at: invoice.paidAt, title: "Marked paid", tone: "ok" });
  if (invoice.status === "CANCELLED") events.push({ at: invoice.updatedAt, title: "Written off", tone: "muted" });
  for (const a of auditRows) {
    if (a.action === "billing.charge" || a.action === "billing.refund") continue; // represented above
    events.push({ at: a.createdAt, title: a.action.replace(/^billing\./, "").replace(/-/g, " "), detail: a.actor ? `by ${a.actor.name ?? a.actor.email}` : undefined, tone: "muted" });
  }
  events.sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <div className="space-y-6">
      <Link href={adminRoutes.loc.billing.payments(slug)} className="inline-flex items-center gap-1 text-apple-sm text-apple-text-secondary hover:text-apple-text">
        <ArrowLeft className="h-4 w-4" /> Payments
      </Link>
      <PageHeader
        title={`Invoice #${invoice.number}`}
        description={invoice.description ?? (invoice.subscription ? `${invoice.subscription.plan.name} · ${invoice.subscription.plan.billingCadence.toLowerCase()}` : undefined)}
        meta={
          <>
            <StatusBadge status={invoice.status} />
            <span className="text-apple-sm text-apple-text-secondary">
              {invoice.paidAt ? `Paid ${invoice.paidAt.toLocaleDateString()}` : `Due ${invoice.dueDate.toLocaleDateString()}`}
            </span>
            {invoice.status === "PAST_DUE" && invoice.nextRetryAt && <span className="text-apple-sm text-apple-orange">Next retry {invoice.nextRetryAt.toLocaleDateString()}</span>}
          </>
        }
        actions={
          <InvoiceActions
            invoice={{
              id: invoice.id,
              number: invoice.number,
              status: invoice.status,
              description: invoice.description,
              dueDate: invoice.dueDate.toISOString(),
              adminNotes: invoice.adminNotes,
              totalCents: invoice.totalCents,
              refundedCents: invoice.refundedCents,
              surchargeCents: invoice.surchargeCents,
              payUrl: payToken ? publicPayUrl(payToken) : null,
              memberEmail: invoice.member.email,
            }}
            paymentMethods={paymentMethods.map((p) => ({ id: p.id, brand: p.brand, last4: p.last4, expMonth: p.expMonth, expYear: p.expYear, isDefault: p.isDefault, status: p.status }))}
            charges={invoice.charges.map((c) => ({ id: c.id, status: c.status, amountCents: c.amountCents, refundedCents: c.refunds.filter((r) => r.status === "COMPLETED").reduce((s, r) => s + r.amountCents, 0), squarePaymentId: c.squarePaymentId }))}
            creditBalanceCents={creditBalanceCents}
            currency={location.currency}
            square={square}
          />
        }
      />

      {isOpen && !square.configured && <SquareConnectCallout status={squareStatusPayload()} />}
      {invoice.status === "PAST_DUE" && invoice.lastFailureReason && (
        <div className="rounded-apple border border-apple-red/30 bg-apple-red/5 p-3 text-apple-sm text-apple-red">
          Last decline: {invoice.lastFailureReason} · {invoice.attemptCount} attempt{invoice.attemptCount === 1 ? "" : "s"}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card padded={false}>
            <div className="px-5 pt-5"><CardHeader title="Line items" /></div>
            <table className="mt-3 w-full text-apple-sm">
              <thead className="text-left text-apple-xs uppercase tracking-wide text-apple-text-tertiary">
                <tr><th className="px-5 py-2 font-medium">Item</th><th className="px-5 py-2 text-right font-medium">Qty</th><th className="px-5 py-2 text-right font-medium">Amount</th></tr>
              </thead>
              <tbody className="divide-y divide-apple-divider">
                {invoice.lineItems.map((l) => (
                  <tr key={l.id}><td className="px-5 py-2 text-apple-text">{l.description}</td><td className="px-5 py-2 text-right tabular-nums">{l.quantity}</td><td className="px-5 py-2 text-right"><Money cents={l.totalCents} currency={location.currency} /></td></tr>
                ))}
                {invoice.lineItems.length === 0 && <tr><td colSpan={3} className="px-5 py-4 text-center text-apple-text-tertiary">No line items</td></tr>}
              </tbody>
              <tfoot className="text-apple-sm">
                <tr><td colSpan={2} className="px-5 pt-3 text-right text-apple-text-secondary">Subtotal</td><td className="px-5 pt-3 text-right"><Money cents={invoice.subtotalCents} currency={location.currency} /></td></tr>
                {invoice.discountCents > 0 && <tr><td colSpan={2} className="px-5 py-1 text-right text-apple-text-secondary">Discount{discountApplications.length ? ` (${discountApplications.map((d) => d.discount.code).join(", ")})` : ""}</td><td className="px-5 py-1 text-right text-apple-green">−<Money cents={invoice.discountCents} currency={location.currency} /></td></tr>}
                {invoice.taxCents > 0 && <tr><td colSpan={2} className="px-5 py-1 text-right text-apple-text-secondary">Tax</td><td className="px-5 py-1 text-right"><Money cents={invoice.taxCents} currency={location.currency} /></td></tr>}
                {invoice.surchargeCents > 0 && <tr><td colSpan={2} className="px-5 py-1 text-right text-apple-text-secondary">Card surcharge</td><td className="px-5 py-1 text-right"><Money cents={invoice.surchargeCents} currency={location.currency} /></td></tr>}
                <tr className="font-semibold text-apple-text"><td colSpan={2} className="px-5 py-2 text-right">Total</td><td className="px-5 py-2 text-right"><Money cents={invoice.totalCents} currency={location.currency} /></td></tr>
                {invoice.refundedCents > 0 && <tr><td colSpan={2} className="px-5 pb-1 text-right text-apple-text-secondary">Refunded</td><td className="px-5 pb-1 text-right">−<Money cents={invoice.refundedCents} currency={location.currency} /></td></tr>}
                {isOpen && <tr className="text-apple-text"><td colSpan={2} className="px-5 pb-4 text-right">Balance due</td><td className="px-5 pb-4 text-right font-semibold"><Money cents={remaining} currency={location.currency} /></td></tr>}
              </tfoot>
            </table>
          </Card>

          <Card>
            <CardHeader title="Payments & refunds" />
            {invoice.charges.length === 0 ? (
              <p className="mt-3 text-apple-sm text-apple-text-tertiary">No payment attempts yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-apple-divider">
                {invoice.charges.map((c) => (
                  <li key={c.id} className="py-3 text-apple-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={c.status} size="sm" />
                          <span className="text-apple-text">{c.paymentMethod ? `${c.paymentMethod.brand} •••• ${c.paymentMethod.last4}` : c.squarePaymentId ? "Card" : "Offline payment"}</span>
                        </div>
                        <div className="mt-0.5 truncate text-apple-xs text-apple-text-tertiary">
                          {c.createdAt.toLocaleString()} · attempt {c.attempt}{c.squarePaymentId ? ` · ${c.squarePaymentId}` : ""}{c.failureReason ? ` · ${c.failureReason}` : ""}
                        </div>
                      </div>
                      <Money cents={c.amountCents} currency={location.currency} className="font-medium" />
                    </div>
                    {c.refunds.length > 0 && (
                      <ul className="mt-2 space-y-1 pl-4 text-apple-xs text-apple-text-secondary">
                        {c.refunds.map((r) => (
                          <li key={r.id} className="flex items-center justify-between">
                            <span>Refund · {r.status.toLowerCase()}{r.reason ? ` · ${r.reason}` : ""}{r.squareRefundId ? ` · ${r.squareRefundId}` : ""}</span>
                            <span>−<Money cents={r.amountCents} currency={location.currency} /></span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {invoice.adminNotes && (
            <Card>
              <CardHeader title="Internal notes" subtitle="Not visible to the member" />
              <p className="mt-3 whitespace-pre-wrap text-apple-sm text-apple-text">{invoice.adminNotes}</p>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Member" />
            <div className="mt-3 text-apple-sm">
              <Link href={adminRoutes.loc.members.detail(slug, invoice.member.id)} className="font-medium text-apple-text hover:underline">
                {invoice.member.firstName} {invoice.member.lastName}
              </Link>
              <div className="text-apple-text-secondary">{invoice.member.email}</div>
              <div className="text-apple-text-secondary">{invoice.member.phone}</div>
              <div className="mt-2 flex items-center gap-2"><StatusBadge status={invoice.member.status} size="sm" />{creditBalanceCents > 0 && <span className="text-apple-xs text-apple-green">Credit <Money cents={creditBalanceCents} currency={location.currency} /></span>}</div>
              <Link href={`${adminRoutes.loc.billing.payments(slug)}?memberId=${invoice.member.id}`} className="mt-3 inline-block text-apple-xs text-apple-blue hover:underline">All invoices for this member →</Link>
            </div>
            {paymentMethods.length > 0 && (
              <div className="mt-4 border-t border-apple-divider pt-3">
                <div className="text-apple-xs font-medium text-apple-text-tertiary">Cards on file</div>
                <ul className="mt-1 space-y-1 text-apple-sm">
                  {paymentMethods.map((p) => (
                    <li key={p.id} className="flex items-center justify-between">
                      <span>{p.brand ?? "Card"} •••• {p.last4} <span className="text-apple-xs text-apple-text-tertiary">{String(p.expMonth ?? "").padStart(2, "0")}/{p.expYear}</span></span>
                      <span className="text-apple-xs text-apple-text-tertiary">{p.isDefault ? "default" : ""}{p.status !== "ACTIVE" ? ` ${p.status.toLowerCase()}` : ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          {invoice.subscription && (
            <Card>
              <CardHeader title="Subscription" />
              <div className="mt-3 space-y-1 text-apple-sm">
                <div className="font-medium text-apple-text">{invoice.subscription.plan.name}</div>
                <div className="text-apple-text-secondary"><Money cents={invoice.subscription.priceCents} currency={location.currency} /> / {invoice.subscription.billingCadence.toLowerCase()}</div>
                <div className="flex items-center gap-2"><StatusBadge status={invoice.subscription.status} size="sm" /></div>
                {invoice.subscription.nextInvoiceDate && <div className="text-apple-xs text-apple-text-tertiary">Next invoice {invoice.subscription.nextInvoiceDate.toLocaleDateString()}</div>}
                <Link href={adminRoutes.loc.billing.recurring(slug)} className="inline-block text-apple-xs text-apple-blue hover:underline">Recurring →</Link>
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Timeline" />
            <ol className="mt-3 space-y-3">
              {events.map((e, i) => (
                <li key={i} className="flex gap-3 text-apple-sm">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.tone === "ok" ? "bg-apple-green" : e.tone === "bad" ? "bg-apple-red" : "bg-apple-border"}`} />
                  <div className="min-w-0">
                    <div className="text-apple-text">{e.title}</div>
                    {e.detail && <div className="truncate text-apple-xs text-apple-text-tertiary">{e.detail}</div>}
                    <div className="text-[10px] text-apple-text-tertiary">{e.at.toLocaleString()}</div>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}

function fmt(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}
