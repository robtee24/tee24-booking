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

const SECTIONS = [
  {
    title: "Organization",
    body: "Brand, contact info, default timezone, multi-org boundary.",
    href: "/admin/settings",
    icon: <Building2 className="h-5 w-5" />,
    accent: "blue" as const,
  },
  {
    title: "Admins",
    body: "Manage admin users, roles, permissions, and 2FA.",
    href: "/admin/admins",
    icon: <Users className="h-5 w-5" />,
    accent: "blue" as const,
  },
  {
    title: "Locations",
    body: "Hours, bays, Kisi door mappings, and Bay App settings per location.",
    href: "/admin/locations",
    icon: <Building2 className="h-5 w-5" />,
    accent: "blue" as const,
  },
  {
    title: "Square (payments)",
    body: "API token, webhook signature key, default location id.",
    href: "/admin/settings/health",
    icon: <CreditCard className="h-5 w-5" />,
    accent: "green" as const,
  },
  {
    title: "Kisi (door access)",
    body: "API key, webhook secret, door-to-location map.",
    href: "/admin/settings/health",
    icon: <KeyRound className="h-5 w-5" />,
    accent: "purple" as const,
  },
  {
    title: "Quo (SMS)",
    body: "API key, sender number, opt-in keyword, brand name.",
    href: "/admin/settings/health",
    icon: <MessageSquare className="h-5 w-5" />,
    accent: "orange" as const,
  },
  {
    title: "Resend (email)",
    body: "API key, default From, reply-to address, footer.",
    href: "/admin/settings/health",
    icon: <Mail className="h-5 w-5" />,
    accent: "orange" as const,
  },
  {
    title: "PayPal Payouts",
    body: "Client ID/Secret, sandbox/live, payout approval workflow.",
    href: "/admin/settings/health",
    icon: <Banknote className="h-5 w-5" />,
    accent: "green" as const,
  },
  {
    title: "Compliance",
    body: "TCPA opt-in language, CAN-SPAM unsubscribe, GDPR/CCPA export & deletion.",
    href: "/admin/settings",
    icon: <Shield className="h-5 w-5" />,
    accent: "purple" as const,
  },
  {
    title: "Audit log",
    body: "View and export audit log entries — every admin action is recorded.",
    href: "/admin/settings/audit-log",
    icon: <ScrollText className="h-5 w-5" />,
    accent: "blue" as const,
  },
  {
    title: "Integration health",
    body: "Webhook delivery dashboard, reconciliation jobs, integration status.",
    href: "/admin/settings/health",
    icon: <Activity className="h-5 w-5" />,
    accent: "green" as const,
  },
  {
    title: "Churn risk model",
    body: "Active model version, accuracy metrics, and v2 training history.",
    href: "/admin/settings/churn-model",
    icon: <Bot className="h-5 w-5" />,
    accent: "purple" as const,
  },
  {
    title: "Migration",
    body: "Gymdesk import status, dry-run, sync, and cutover runbook.",
    href: "/admin/settings/migration",
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

export default function OrgSettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization settings"
        description="Centralize integrations, compliance, and reliability tooling."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => (
          <Link key={s.title} href={s.href} className="group">
            <Card className="transition-all hover:-translate-y-0.5 hover:shadow-apple-md">
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
