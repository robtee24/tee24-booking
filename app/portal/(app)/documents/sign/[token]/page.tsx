// /portal/documents/sign/[token] — signing inside the logged-in portal.
// Same experience as the public /sign/[token]; the portal layout supplies
// the chrome. If the token belongs to a different member we don't reveal it.
import { notFound } from "next/navigation";
import { getCurrentMember } from "@/lib/member-session";
import { getPrisma } from "@/lib/db";
import { loadSigningView } from "@/services/portal.service";
import { SignDocumentView } from "@/components/portal/SignDocumentView";

export const dynamic = "force-dynamic";

export default async function PortalSignPage({ params }: { params: Promise<{ token: string }> }) {
  const member = await getCurrentMember();
  if (!member) return null;
  const { token: raw } = await params;
  const token = decodeURIComponent(raw);
  const owner = await getPrisma().documentAssignment.findUnique({ where: { signingToken: token }, select: { memberId: true } });
  if (owner && owner.memberId !== member.id) notFound();
  const view = await loadSigningView(token, { markViewed: true });

  return (
    <SignDocumentView
      token={token}
      view={{ ...view, signedAt: view.signedAt?.toISOString() ?? null, expiresAt: view.expiresAt?.toISOString() ?? null }}
      backHref="/portal/documents"
      backLabel="Back to my documents"
      loggedIn
    />
  );
}
