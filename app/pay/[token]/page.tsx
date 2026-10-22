/**
 * Public hosted invoice page: /pay/[token]
 * Anyone with the link can view the invoice summary and pay by card (Square).
 * When Square isn't configured the page shows a "contact the front desk" notice.
 */
import { notFound } from "next/navigation";
import { getPrisma } from "@/lib/db";
import { getSquarePublicConfig } from "@/lib/square";
import { invoiceRemainingCents, PAID_STATUSES } from "@/services/billing.service";
import { PayClient } from "./PayClient";

export const dynamic = "force-dynamic";

export default async function HostedPayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 8) notFound();
  const inv = await getPrisma().invoice.findUnique({
    where: { payToken: token },
    include: {
      lineItems: { orderBy: { sortOrder: "asc" } },
      member: { select: { firstName: true, lastName: true, email: true, phone: true, zip: true } },
      location: { select: { name: true, businessName: true, currency: true, logoUrl: true, phone: true, email: true } },
      subscription: { select: { plan: { select: { name: true } } } },
    },
  });
  if (!inv) notFound();

  const payable = !(PAID_STATUSES as readonly string[]).includes(inv.status) && inv.status !== "CANCELLED" && invoiceRemainingCents(inv) > 0;

  return (
    <PayClient
      token={token}
      square={await getSquarePublicConfig(inv.locationId)}
      invoice={{
        number: inv.number,
        status: inv.status,
        description: inv.description,
        dueDate: inv.dueDate.toISOString(),
        paidAt: inv.paidAt?.toISOString() ?? null,
        subtotalCents: inv.subtotalCents,
        discountCents: inv.discountCents,
        taxCents: inv.taxCents,
        surchargeCents: inv.surchargeCents,
        totalCents: inv.totalCents,
        remainingCents: invoiceRemainingCents(inv),
        currency: inv.location.currency,
        lineItems: inv.lineItems.map((l) => ({ id: l.id, description: l.description, quantity: l.quantity, totalCents: l.totalCents })),
        planName: inv.subscription?.plan.name ?? null,
        payable,
      }}
      member={{ firstName: inv.member.firstName, lastName: inv.member.lastName, email: inv.member.email, phone: inv.member.phone, zip: inv.member.zip }}
      location={{ name: inv.location.businessName ?? inv.location.name, logoUrl: inv.location.logoUrl, phone: inv.location.phone, email: inv.location.email }}
    />
  );
}
