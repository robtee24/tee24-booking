import Link from "next/link";
import { Download, HelpCircle, CalendarClock, LockKeyhole, Play } from "lucide-react";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { getAccessibleLocations } from "@/lib/access";
import { adminRoutes } from "@/lib/admin/routes";
import { KIOSK_APP_NAME, KIOSK_DOWNLOAD_URL } from "@/lib/kiosk/download";

export const dynamic = "force-dynamic";

export default async function BayAppPage() {
  const locations = await getAccessibleLocations().catch(() => []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bay kiosk app"
        description={`${KIOSK_APP_NAME} runs on every bay computer. It replaces the Golfin Launcher home screen, launches GSPro, and handles reservations.`}
        actions={
          <a href={KIOSK_DOWNLOAD_URL} target="_blank" rel="noreferrer" className="btn-primary inline-flex items-center gap-2">
            <Download className="h-4 w-4" />
            Download for Windows
          </a>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Feature icon={<Play className="h-5 w-5" />} title="Play" body="One tap launches the launch-monitor software and GSPro together." />
        <Feature icon={<HelpCircle className="h-5 w-5" />} title="Help, always" body="A floating Help button opens the troubleshooting guide for that bay's launch monitor." />
        <Feature icon={<CalendarClock className="h-5 w-5" />} title="Schedule" body="Players see today's reservations for the bay they're standing in." />
        <Feature icon={<LockKeyhole className="h-5 w-5" />} title="Reservation unlock" body="At start time the member enters their phone number to claim the bay." />
      </div>

      <Card>
        <CardHeader title="Per-location setup" subtitle="Kiosk behavior and registered computers are managed per location." />
        {locations.length === 0 ? (
          <p className="mt-3 text-apple-sm text-apple-text-tertiary">No locations available.</p>
        ) : (
          <ul className="mt-4 divide-y divide-apple-divider rounded-apple-sm border border-apple-border">
            {locations.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-apple-sm">
                <span className="font-medium text-apple-text">{l.name}</span>
                <Link href={adminRoutes.loc.settings.bayApp(l.slug)} className="font-medium text-apple-blue hover:underline">
                  Kiosk settings →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Requirements" />
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-apple-sm text-apple-text-secondary">
          <li>Windows 10 or 11 bay PC with GSPro and the launch-monitor software installed.</li>
          <li>Internet connection on the bay PC (the kiosk checks the schedule every 30 seconds).</li>
          <li>Kiosk enabled in the location&apos;s <em>Bay Kiosk</em> settings.</li>
          <li>Golfin Launcher removed from Windows startup so the kiosk is the first screen.</li>
        </ul>
      </Card>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <Card>
      <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-apple-sm bg-apple-blue/10 text-apple-blue">{icon}</span>
      <h2 className="text-apple-base font-semibold text-apple-text">{title}</h2>
      <p className="mt-1 text-apple-sm text-apple-text-secondary">{body}</p>
    </Card>
  );
}
