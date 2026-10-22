import { getCurrentMember } from "@/lib/member-session";
import { getMembershipCard } from "@/services/portal.service";
import { encodeQr, qrToSvg } from "@/components/portal/qr";
import { PortalSubNav } from "@/components/portal/PortalSubNav";
import { MemberCard } from "@/components/portal/MemberCard";

export const dynamic = "force-dynamic";

export default async function PortalCardPage() {
  const member = await getCurrentMember();
  if (!member) return null;
  const card = await getMembershipCard(member.id);
  const qrSvg = qrToSvg(encodeQr(card.qrPayload), { size: 220, margin: 2 });

  return (
    <div className="space-y-6">
      <div className="space-y-3 print:hidden">
        <h1 className="text-apple-2xl font-semibold tracking-tight">Membership card</h1>
        <PortalSubNav />
      </div>
      <MemberCard
        card={{
          ...card,
          memberSince: card.memberSince.toISOString(),
          validThrough: card.validThrough?.toISOString() ?? null,
        }}
        qrSvg={qrSvg}
      />
    </div>
  );
}
