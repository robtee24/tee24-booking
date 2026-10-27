import Link from "next/link";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import {
  Building2,
  CreditCard,
  KeyRound,
  MessageSquare,
  Mail,
  Banknote,
  Shield,
  ScrollText,
  Activity,
  Bot,
  Database,
  Users,
} from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { getCurrentAdmin, isFullAccess } from "@/lib/access";
import { getPrisma } from "@/lib/db";
import { MyAccountCard, type MeDTO } from "@/components/admin/staff/MyAccountCard";

export const dynamic = "force-dynamic";

const SECTIONS = [
  {
    title: "Organization, email & SMS",
    body: "Brand, contact info, email/SMS kill switches, reply-to, BCC, and email footer.",
    href: adminRoutes.settingsEmail(),
    icon: <Building2 className="h-5 w-5" />,
    accent: "blue" as const,
    fullOnly: true,
  },
  {
    title: "Admins",
    body: "Manage admin users, roles, permissions, invites, PINs, and 2FA.",
    href: adminRoutes.admins(),
    icon: <Users className="h-5 w-5" />,
    accent: "blue" as const,
  },
  {
    title: "Locations",
    body: "Details, hours, bays, Kisi door mappings, and Bay App settings per location.",
    href: adminRoutes.locations(),
    icon: <Building2 className="h-5 w-5" />,
    accent: "blue" as const,
  },
  {
    title: "Square (payments)",
    body: "Connect each location's Square account under Billing → Settings.",
    href: "square" as const,
    icon: <CreditCard className="h-5 w-5" />,
    accent: "green" as const,
  },
  {
    title: "Kisi (door access)",
    body: "Live door status, remote unlock, and which location each lock belongs to.",
    href: adminRoutes.doorAccess(),
    icon: <KeyRound className="h-5 w-5" />,
    accent: "purple" as const,
  },
  {
    title: "Quo (SMS)",
    body: "Sender number, marketing SMS, and opt-in language.",
    href: "quo" as const,
    icon: <MessageSquare className="h-5 w-5" />,
    accent: "orange" as const,
  },
  {
    title: "Resend (email)",
    body: "API key, default From, reply-to address, footer.",
    href: adminRoutes.settingsEmail(),
    icon: <Mail className="h-5 w-5" />,
    accent: "orange" as const,
  },
  {
    title: "PayPal Payouts",
    body: "Referral payouts are configured under Marketing → Referrals.",
    href: "paypal" as const,
    icon: <Banknote className="h-5 w-5" />,
    accent: "green" as const,
  },
  {
    title: "Compliance",
    body: "TCPA opt-in language, CAN-SPAM unsubscribe, GDPR/CCPA export & deletion.",
    href: adminRoutes.settingsEmail(),
    icon: <Shield className="h-5 w-5" />,
    accent: "purple" as const,
  },
  {
    title: "Audit log",
    body: "View and filter audit log entries — every admin action is recorded.",
    href: adminRoutes.settingsAuditLog(),
    icon: <ScrollText className="h-5 w-5" />,
    accent: "blue" as const,
  },
  {
    title: "Integration health",
    body: "Webhook delivery dashboard, reconciliation jobs, integration status.",
    href: adminRoutes.settingsHealth(),
    icon: <Activity className="h-5 w-5" />,
    accent: "green" as const,
  },
  {
    title: "Churn risk model",
    body: "Active model version, accuracy metrics, and v2 training history.",
    href: adminRoutes.settingsChurnModel(),
    icon: <Bot className="h-5 w-5" />,
    accent: "purple" as const,
  },
  {
    title: "Migration",
    body: "Gymdesk import status, dry-run, sync, and cutover runbook.",
    href: adminRoutes.settingsMigration(),
    icon: <Database className="h-5 w-5" />,
    accent: "orange" as const,
  },
];

const ACCENT: Record<string, string> = {
  blue: "bg-apple-blue/10 text-apple-blue",
  green: "bg-apple-green/10 text-apple-green",
  orange: "bg-apple-orange/10 text-apple-orange",
  purple: "bg-apple-purple/10 text-apple-purple",
};

export default async function OrgSettingsPage() {
  const me = await getCurrentAdmin();
  if (!me) return null;
  const row = await getPrisma().admin.findUnique({
    where: { id: me.id },
    select: { id: true, name: true, email: true, phone: true, role: true, twoFactorEnabled: true, lastLoginAt: true },
  });
  const meDto: MeDTO | null = row
    ? {
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        role: row.role,
        twoFactorEnabled: row.twoFactorEnabled,
        lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      }
    : null;

  const full = isFullAccess(me.role);
  const firstLoc = await getPrisma().location.findFirst({ orderBy: { name: "asc" }, select: { slug: true, name: true } });
  const resolveHref = (href: string) => {
    if (href === "square") return firstLoc ? adminRoutes.loc.billing.settings(firstLoc.slug) : adminRoutes.locations();
    if (href === "quo") return firstLoc ? adminRoutes.loc.marketing.settings(firstLoc.slug) : adminRoutes.settingsEmail();
    if (href === "paypal") return firstLoc ? adminRoutes.loc.marketing.referrals(firstLoc.slug) : adminRoutes.locations();
    return href;
  };
  const sections = SECTIONS.filter((s) => !s.fullOnly || full).map((s) => ({ ...s, href: resolveHref(s.href) }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Your account, organization defaults, integrations, compliance, and reliability tooling."
      />

      {meDto && <MyAccountCard me={meDto} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((s) => (
          <Link key={s.title} href={s.href} className="group">
            <Card className="h-full transition-all hover:-translate-y-0.5 hover:shadow-apple-md">
              <div className="flex items-start gap-3">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-apple-sm ${ACCENT[s.accent]}`}>
                  {s.icon}
                </div>
                <div className="min-w-0">
                  <CardHeader title={s.title} />
                  <p className="mt-1 text-apple-sm text-apple-text-secondary">{s.body}</p>
                  <span className="mt-2 inline-block text-apple-xs font-medium text-apple-blue group-hover:underline">
                    Open →
                  </span>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
