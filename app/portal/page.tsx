import { Card, CardHeader, StatusBadge, Money } from "@/components/ui";
import { getCurrentMember } from "@/lib/member-session";
import { getPrisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function PortalProfile() {
  const member = await getCurrentMember();
  if (!member) return null;
  const prisma = getPrisma();
  const sub = await prisma.membershipSubscription.findFirst({
    where: { memberId: member.id, status: { in: ["ACTIVE", "CANCEL_SCHEDULED", "FROZEN", "COMP"] } },
    include: { plan: true },
    orderBy: { startDate: "desc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-apple-2xl font-semibold tracking-tight">Welcome back, {member.firstName}</h1>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Your membership" />
          {sub ? (
            <>
              <div className="mt-3 flex items-center justify-between">
                <span className="font-medium text-apple-text">{sub.plan.name}</span>
                <StatusBadge status={sub.status} size="sm" />
              </div>
              <div className="mt-1 text-apple-sm text-apple-text-secondary"><Money cents={sub.priceCents} /> / {sub.billingCadence.toLowerCase()}</div>
              {sub.paidThroughDate && (
                <div className="mt-1 text-apple-xs text-apple-text-tertiary">Paid through {new Date(sub.paidThroughDate).toLocaleDateString()}</div>
              )}
            </>
          ) : (
            <p className="mt-3 text-apple-sm text-apple-text-tertiary">You don't have an active membership.</p>
          )}
        </Card>

        <Card>
          <CardHeader title="Door access" />
          <div className="mt-3">
            {member.kisiAccessEnabled ? (
              <p className="text-apple-sm text-apple-green">Enabled — open the door from your Kisi mobile app.</p>
            ) : (
              <p className="text-apple-sm text-apple-red">Disabled. {member.kisiAccessReason ?? "Contact us if you need help."}</p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Profile" />
          <dl className="mt-3 space-y-1.5 text-apple-sm">
            <div className="flex justify-between"><dt className="text-apple-text-secondary">Email</dt><dd>{member.email}</dd></div>
            <div className="flex justify-between"><dt className="text-apple-text-secondary">Phone</dt><dd>{member.phone}</dd></div>
            {member.dob && (
              <div className="flex justify-between"><dt className="text-apple-text-secondary">DOB</dt><dd>{new Date(member.dob).toLocaleDateString()}</dd></div>
            )}
          </dl>
        </Card>

        <Card>
          <CardHeader title="Refer a friend" />
          {member.referralCode ? (
            <div className="mt-3 text-apple-sm">
              <p className="text-apple-text">Share your code:</p>
              <code className="mt-1 inline-block rounded bg-apple-fill-secondary px-2 py-1 font-mono text-apple-base text-apple-text">{member.referralCode}</code>
            </div>
          ) : (
            <p className="mt-3 text-apple-sm text-apple-text-tertiary">Referral program not yet activated.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
