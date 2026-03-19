'use client';

const DOWNLOAD_LINKS = {
  windows: '/downloads/Tee24-Bay-CheckIn-Setup.exe',
  mac: '/downloads/Tee24-Bay-CheckIn.dmg',
};

export default function BayAppPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Bay App</h1>
        <p className="mt-1 text-sm text-gray-600">
          Download and install the Tee24 Bay Check-In app on each bay computer.
        </p>
      </header>

      {/* Download Section */}
      <section className="card p-6">
        <h2 className="text-apple-lg font-semibold text-apple-text mb-1">Download</h2>
        <p className="text-apple-sm text-apple-text-secondary mb-5">
          The Bay Check-In app runs on each bay&apos;s computer. It locks the screen when a reservation starts and requires
          the guest to verify their phone number to unlock.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Windows */}
          <a
            href={DOWNLOAD_LINKS.windows}
            className="flex items-center gap-4 rounded-xl border border-apple-border bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-apple-blue/40"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50">
              <svg className="h-6 w-6 text-blue-600" viewBox="0 0 24 24" fill="currentColor">
                <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
              </svg>
            </div>
            <div>
              <div className="text-apple-sm font-semibold text-apple-text">Windows</div>
              <div className="text-apple-xs text-apple-text-tertiary">Download .exe installer</div>
            </div>
          </a>

          {/* Mac */}
          <a
            href={DOWNLOAD_LINKS.mac}
            className="flex items-center gap-4 rounded-xl border border-apple-border bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-apple-blue/40"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100">
              <svg className="h-6 w-6 text-gray-700" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
              </svg>
            </div>
            <div>
              <div className="text-apple-sm font-semibold text-apple-text">macOS</div>
              <div className="text-apple-xs text-apple-text-tertiary">Download .dmg installer</div>
            </div>
          </a>
        </div>
      </section>

      {/* Setup Instructions */}
      <section className="card p-6">
        <h2 className="text-apple-lg font-semibold text-apple-text mb-1">Setup</h2>
        <p className="text-apple-sm text-apple-text-secondary mb-4">
          After installing, follow these steps on each bay computer:
        </p>
        <ol className="space-y-3 text-apple-sm text-apple-text">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-apple-blue text-xs font-bold text-white">1</span>
            <span>Open the Tee24 Bay Check-In app</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-apple-blue text-xs font-bold text-white">2</span>
            <span>Log in with your admin phone number (you&apos;ll receive a one-time code)</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-apple-blue text-xs font-bold text-white">3</span>
            <span>Select the location and assign the bay number for this computer</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-apple-blue text-xs font-bold text-white">4</span>
            <span>The app will automatically lock the screen at reservation time and require phone verification to unlock</span>
          </li>
        </ol>
      </section>

      {/* Requirements */}
      <section className="card p-6">
        <h2 className="text-apple-lg font-semibold text-apple-text mb-1">Requirements</h2>
        <ul className="mt-3 space-y-2 text-apple-sm text-apple-text-secondary">
          <li className="flex items-start gap-2">
            <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-apple-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Bay App must be enabled in each location&apos;s Details settings
          </li>
          <li className="flex items-start gap-2">
            <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-apple-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Internet connection required on each bay computer
          </li>
          <li className="flex items-start gap-2">
            <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-apple-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Windows 10+ or macOS 11+
          </li>
        </ul>
      </section>
    </div>
  );
}
