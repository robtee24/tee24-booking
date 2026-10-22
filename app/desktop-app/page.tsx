import type { Metadata } from "next";
import Link from "next/link";
import { Download, HelpCircle, LockKeyhole, Play, CalendarClock, RefreshCw, ShieldCheck } from "lucide-react";
import { getLatestKioskRelease } from "@/lib/kiosk/release";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tee24 Bay Kiosk — Desktop App",
  description: "Download the Tee24 Bay Kiosk for bay computers.",
  robots: { index: false },
};

export default async function DesktopAppPage() {
  const rel = await getLatestKioskRelease();

  return (
    <main className="min-h-dvh bg-apple-bg text-apple-text">
      <div className="mx-auto max-w-3xl px-5 py-12 sm:py-20">
        <div className="flex items-center gap-2 text-apple-sm font-semibold text-apple-blue">
          <span className="flex h-7 w-7 items-center justify-center rounded-apple-sm bg-apple-blue text-[11px] font-bold text-white">T24</span>
          Tee24
        </div>
        <h1 className="mt-4 text-apple-3xl font-semibold tracking-tight sm:text-apple-hero">Tee24 Bay Kiosk</h1>
        <p className="mt-3 max-w-xl text-apple-lg text-apple-text-secondary">
          The desktop app for every bay computer. It opens on boot, replaces the Golfin Launcher home screen, launches GSPro, shows setup help, and unlocks the bay for reservations.
        </p>

        <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <a href="/desktop-app/download" className="btn-primary inline-flex items-center gap-2 !px-6 !py-3 text-apple-base">
            <Download className="h-5 w-5" />
            Download for Windows
          </a>
          <div className="text-apple-sm text-apple-text-tertiary">
            {rel ? (
              <>
                Version {rel.version}
                {rel.installerSize ? ` · ${(rel.installerSize / 1024 / 1024).toFixed(0)} MB` : ""}
                {rel.publishedAt ? ` · ${new Date(rel.publishedAt).toLocaleDateString()}` : ""}
              </>
            ) : (
              <>First build publishing soon — this link will always point at the newest version.</>
            )}
          </div>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          <Feature icon={<Play className="h-5 w-5" />} title="Play" body="One tap starts the launch-monitor software and GSPro together." />
          <Feature icon={<HelpCircle className="h-5 w-5" />} title="Help, any time" body="A floating Help button walks players through the troubleshooting guide for that bay's launch monitor." />
          <Feature icon={<CalendarClock className="h-5 w-5" />} title="Schedule" body="Players see today's reservations for the bay they're standing in." />
          <Feature icon={<LockKeyhole className="h-5 w-5" />} title="Reservation unlock" body="At start time, the member enters their phone number to claim the bay. Ten minutes before, players get a heads-up with a countdown." />
          <Feature icon={<RefreshCw className="h-5 w-5" />} title="Always up to date" body="Checks for a new version every time it opens and updates itself before showing the home screen." />
          <Feature icon={<ShieldCheck className="h-5 w-5" />} title="Admin settings" body="A Settings button in the corner; only Tee24 admins can sign in (text-message code) to change the bay." />
        </div>

        <section className="mt-12 rounded-apple border border-apple-divider bg-white p-5 shadow-apple sm:p-6">
          <h2 className="text-apple-xl font-semibold">Install on a bay computer</h2>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-apple-base text-apple-text">
            <li>Download and run the installer on the bay PC. It installs for all users and starts at login.</li>
            <li>On first launch, sign in with your admin phone number (you&apos;ll get a text code).</li>
            <li>Pick the location and the bay number for this computer. Each computer is assigned to exactly one bay.</li>
            <li>Confirm the paths to the launch-monitor software and GSPro (defaults are pre-filled).</li>
            <li>Remove the Golfin Launcher from Windows startup so the kiosk is the first thing players see.</li>
          </ol>
          <p className="mt-4 text-apple-sm text-apple-text-tertiary">
            Requires Windows 10 or 11 and an internet connection. Staff can open Settings any time from the gear in the top-right corner, or with Ctrl+Shift+T while GSPro is running.
          </p>
        </section>

        <p className="mt-8 text-apple-sm text-apple-text-tertiary">
          Admins: manage kiosk settings and remote support from the{" "}
          <Link href="/admin" className="font-medium text-apple-blue hover:underline">admin console</Link>.
        </p>
      </div>
    </main>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-apple border border-apple-divider bg-white p-5 shadow-apple">
      <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-apple-sm bg-apple-blue/10 text-apple-blue">{icon}</span>
      <h3 className="text-apple-base font-semibold">{title}</h3>
      <p className="mt-1 text-apple-sm text-apple-text-secondary">{body}</p>
    </div>
  );
}
