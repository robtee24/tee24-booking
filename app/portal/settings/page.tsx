import { Card, CardHeader } from "@/components/ui";
import { getCurrentMember } from "@/lib/member-session";
import { SettingsClient } from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function PortalSettings() {
  const member = await getCurrentMember();
  if (!member) return null;

  return (
    <div className="space-y-6">
      <h1 className="text-apple-2xl font-semibold tracking-tight">Settings</h1>

      <SettingsClient
        memberId={member.id}
        emailOptIn={member.optInEmailMarketing}
        smsOptIn={member.optInSmsMarketing}
      />

      <Card>
        <CardHeader title="Privacy" subtitle="Download or delete your personal data." />
        <div className="mt-4 flex flex-wrap gap-3">
          <a
            href="/api/portal/data-export"
            className="inline-flex items-center rounded-apple-pill border border-apple-border bg-white px-5 py-2.5 text-apple-sm font-medium text-apple-text hover:bg-apple-fill-secondary"
          >
            Download my data
          </a>
          <DeleteAccountButton />
        </div>
        <p className="mt-3 text-apple-xs text-apple-text-tertiary">
          Deletion requests are reviewed by staff. Final deletion happens after any open billing or legal hold expires.
        </p>
      </Card>
    </div>
  );
}

function DeleteAccountButton() {
  return (
    <form action="/api/portal/delete-request" method="post">
      <button
        type="submit"
        className="inline-flex items-center rounded-apple-pill border border-apple-red/30 bg-apple-red/5 px-5 py-2.5 text-apple-sm font-medium text-apple-red hover:bg-apple-red/10"
      >
        Request data deletion
      </button>
    </form>
  );
}
