import { Card, CardHeader, PageHeader } from "@/components/ui";

export default function OrgSettingsPage() {
  const sections = [
    { title: "Organization", body: "Brand, contact info, default timezone, multi-org boundary." },
    { title: "Square", body: "API token, webhook signature key, default location id." },
    { title: "Kisi", body: "API key, webhook secret, door-to-location map." },
    { title: "Quo (SMS)", body: "API key, sender number, opt-in keyword, brand name." },
    { title: "Resend (email)", body: "API key, default From, reply-to address, footer." },
    { title: "PayPal Payouts", body: "Client ID/Secret, sandbox/live, payout approval workflow." },
    { title: "Compliance", body: "TCPA opt-in language, CAN-SPAM unsubscribe, GDPR/CCPA export & deletion." },
    { title: "Audit log", body: "View and export audit log entries." },
    { title: "Health", body: "Webhook delivery dashboard, reconciliation jobs, integration status." },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Organization settings" description="Centralize integrations, compliance, and reliability tooling." />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((s) => (
          <Card key={s.title}>
            <CardHeader title={s.title} />
            <p className="mt-2 text-apple-sm text-apple-text-secondary">{s.body}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
