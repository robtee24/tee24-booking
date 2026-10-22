import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getPrisma } from "@/lib/db";
import { adminRoutes } from "@/lib/admin/routes";
import { PageHeader, StatusBadge, Badge } from "@/components/ui";
import { ProfileTabs } from "./ProfileTabs";
import { MemberHeaderActions } from "@/components/admin/members/MemberHeaderActions";
import { Avatar } from "@/components/admin/members/shared";

export const dynamic = "force-dynamic";

/**
 * Shared chrome for every member profile tab: back link, header with status
 * badges + actions, and the tab strip. Each tab page renders below.
 */
export default async function MemberProfileLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const prisma = getPrisma();
  const member = await prisma.member.findUnique({
    where: { id },
    select: {
      id: true, firstName: true, lastName: true, email: true, phone: true, status: true, photoUrl: true, kisiAccessEnabled: true, kisiAccessReason: true,
      checkinCode: true, mergedIntoId: true, joinDate: true, dob: true, gender: true, guardianName: true, acquisitionSource: true, secondaryEmails: true, secondaryPhones: true,
      addressLine1: true, addressLine2: true, city: true, state: true, zip: true, country: true, optInEmailMarketing: true, optInSmsMarketing: true, smsConsentAt: true,
      membershipType: true, magicLinkLastSentAt: true,
      location: { select: { slug: true } },
    },
  });
  if (!member || member.location.slug !== slug) notFound();

  const [latestUsageTier, mergedInto] = await Promise.all([
    prisma.usageTierSnapshot.findFirst({ where: { memberId: id }, orderBy: { computedAt: "desc" }, select: { tier: true } }),
    member.mergedIntoId ? prisma.member.findUnique({ where: { id: member.mergedIntoId }, select: { id: true, firstName: true, lastName: true } }) : null,
  ]);

  return (
    <div className="space-y-6">
      <Link href={adminRoutes.loc.members.list(slug)} className="inline-flex items-center gap-1 text-apple-sm text-apple-text-secondary hover:text-apple-text">
        <ArrowLeft className="h-4 w-4" />
        Back to members
      </Link>

      {member.status === "MERGED" && mergedInto && (
        <div className="rounded-apple border border-apple-orange/30 bg-apple-orange/5 p-3 text-apple-sm text-apple-orange">
          This record was merged into{" "}
          <Link href={adminRoutes.loc.members.detail(slug, mergedInto.id)} className="font-semibold underline">
            {mergedInto.firstName} {mergedInto.lastName}
          </Link>
          . It is kept for history only.
        </div>
      )}

      <div className="flex items-start gap-4">
        <Avatar photoUrl={member.photoUrl} first={member.firstName} last={member.lastName} size="xl" />
        <div className="min-w-0 flex-1">
          <PageHeader
            title={`${member.firstName} ${member.lastName}`}
            meta={
              <>
                <StatusBadge status={member.status} />
                {latestUsageTier && <StatusBadge status={latestUsageTier.tier} />}
                {member.kisiAccessEnabled ? <Badge tone="success">Door access enabled</Badge> : <Badge tone="warn">Door access disabled</Badge>}
                {member.checkinCode && <Badge tone="muted">Code {member.checkinCode}</Badge>}
                <span className="text-apple-xs text-apple-text-tertiary">{member.email} · {member.phone}</span>
              </>
            }
            actions={
              <MemberHeaderActions
                slug={slug}
                member={{
                  ...member,
                  joinDate: member.joinDate?.toISOString() ?? null,
                  dob: member.dob?.toISOString() ?? null,
                  smsConsentAt: member.smsConsentAt?.toISOString() ?? null,
                  magicLinkLastSentAt: member.magicLinkLastSentAt?.toISOString() ?? null,
                  secondaryEmails: (member.secondaryEmails as string[] | null) ?? [],
                  secondaryPhones: (member.secondaryPhones as string[] | null) ?? [],
                }}
              />
            }
          />
        </div>
      </div>

      <ProfileTabs slug={slug} memberId={id} />

      {children}
    </div>
  );
}
