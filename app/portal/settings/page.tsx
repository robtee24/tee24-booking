import { Card, CardHeader } from "@/components/ui";
import { getCurrentMember } from "@/lib/member-session";
import { PortalSubNav } from "@/components/portal/PortalSubNav";
import { SettingsClient } from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function PortalSettings({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const member = await getCurrentMember();
  if (!member) return null;
  const sp = await searchParams;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-apple-2xl font-semibold tracking-tight">Settings</h1>
        <PortalSubNav />
      </div>

      {sp.deleted === "requested" && (
        <div className="rounded-apple-sm bg-apple-green/10 px-4 py-3 text-apple-sm text-apple-green">
          Your deletion request has been sent to our team. We'll confirm by email once it's reviewed.
        </div>
      )}
      {sp.error === "impersonating" && (
        <div className="rounded-apple-sm bg-apple-orange/10 px-4 py-3 text-apple-sm text-apple-orange">That action isn't available while staff are viewing this account.</div>
      )}

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
  // Plain form POST (application/x-www-form-urlencoded). The API accepts both
  // this and JSON, and redirects back here with ?deleted=requested.
  return (
    <details className="group">
      <summary className="inline-flex cursor-pointer list-none items-center rounded-apple-pill border border-apple-red/30 bg-apple-red/5 px-5 py-2.5 text-apple-sm font-medium text-apple-red hover:bg-apple-red/10">
        Request data deletion
      </summary>
      <form action="/api/portal/delete-request" method="post" className="mt-3 w-full max-w-md space-y-3 rounded-apple-sm border border-apple-red/20 bg-white p-4">
        <p className="text-apple-sm text-apple-text">This asks our team to permanently delete your account and personal data. It can't be undone once processed.</p>
        <label className="block">
          <span className="mb-1 block text-apple-xs font-medium text-apple-text-secondary">Reason (optional)</span>
          <textarea name="reason" rows={2} maxLength={1000} className="input w-full" placeholder="Let us know why you're leaving" />
        </label>
        <button type="submit" className="inline-flex items-center rounded-apple-pill bg-apple-red px-5 py-2.5 text-apple-sm font-semibold text-white hover:bg-apple-red/90">
          Confirm deletion request
        </button>
      </form>
    </details>
  );
}
