import { Card, CardHeader, EmptyState, StatusBadge, Money } from "@/components/ui";
import { getCurrentMember } from "@/lib/member-session";
import { getPrisma } from "@/lib/db";
import { Receipt } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PortalBilling() {
  const member = await getCurrentMember();
  if (!member) return null;
  const prisma = getPrisma();

  const [invoices, methods] = await Promise.all([
    prisma.invoice.findMany({ where: { memberId: member.id }, orderBy: { createdAt: "desc" }, take: 25 }),
    prisma.paymentMethod.findMany({ where: { memberId: member.id }, orderBy: { isDefault: "desc" } }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-apple-2xl font-semibold tracking-tight">Billing</h1>

      <Card>
        <CardHeader title="Payment methods" subtitle="We charge your default card on the billing date of each cycle." />
        <div className="mt-4 space-y-2">
          {methods.length === 0 ? (
            <p className="text-apple-sm text-apple-text-tertiary">No card on file.</p>
          ) : (
            methods.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-apple-sm border border-apple-divider px-3 py-2 text-apple-sm">
                <div className="font-medium text-apple-text">{m.brand} •••• {m.last4}</div>
                <div className="text-apple-xs text-apple-text-tertiary">
                  {m.isDefault && "Default · "}Exp {m.expMonth?.toString().padStart(2, "0")}/{m.expYear}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Invoices" />
        {invoices.length === 0 ? (
          <EmptyState icon={<Receipt className="h-6 w-6" />} title="No invoices yet" />
        ) : (
          <ul className="mt-3 divide-y divide-apple-divider">
            {invoices.map((i) => (
              <li key={i.id} className="flex items-center justify-between py-2 text-apple-sm">
                <div>
                  <div className="font-medium text-apple-text">Invoice #{i.number}</div>
                  <div className="text-apple-xs text-apple-text-tertiary">{i.paidAt ? `Paid ${new Date(i.paidAt).toLocaleDateString()}` : `Due ${new Date(i.dueDate).toLocaleDateString()}`}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Money cents={i.totalCents} />
                  <StatusBadge status={i.status} size="sm" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
