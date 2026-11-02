/**
 * Hosted "add a card on file" page: /pay/card/[token]
 * Opened from the Tee24 app (league entry needs a card). The token is a
 * short-lived HMAC minted for the signed-in member.
 */
import { notFound } from "next/navigation";
import { getPrisma } from "@/lib/db";
import { getSquarePublicConfig } from "@/lib/square";
import { verifyCardLinkToken } from "@/lib/card-link";
import { AddCardClient } from "./AddCardClient";

export const dynamic = "force-dynamic";

export default async function AddCardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const memberId = verifyCardLinkToken(token);
  if (!memberId) {
    return (
      <div className="min-h-screen bg-apple-bg py-10">
        <div className="mx-auto max-w-lg px-4 text-center">
          <h1 className="text-apple-xl font-semibold text-apple-text">This link has expired</h1>
          <p className="mt-2 text-apple-sm text-apple-text-secondary">Open Add a card again from the Tee24 app to get a fresh link.</p>
        </div>
      </div>
    );
  }
  const member = await getPrisma().member.findUnique({
    where: { id: memberId },
    select: {
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      zip: true,
      locationId: true,
      location: { select: { name: true, businessName: true, logoUrl: true, phone: true, email: true } },
      paymentMethods: { where: { status: { not: "EXPIRED" }, squareCardId: { not: null } }, select: { brand: true, last4: true }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }], take: 1 },
    },
  });
  if (!member) notFound();
  return (
    <AddCardClient
      token={token}
      square={await getSquarePublicConfig(member.locationId)}
      member={{ firstName: member.firstName, lastName: member.lastName, email: member.email, phone: member.phone, zip: member.zip }}
      existing={member.paymentMethods[0] ?? null}
      location={{ name: member.location.businessName ?? member.location.name, logoUrl: member.location.logoUrl, phone: member.location.phone, email: member.location.email }}
    />
  );
}
