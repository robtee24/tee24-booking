// app/admin/page.tsx
import Link from 'next/link';

export default function AdminHomePage() {
  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div>
        <h1 className="text-apple-2xl font-semibold tracking-tight text-apple-text">
          Admin Dashboard
        </h1>
        <p className="mt-1 text-apple-base text-apple-text-secondary">
          Manage your Tee24 locations, notifications, bays, bookings, and admins.
        </p>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/admin/locations"
          className="card group p-6 transition-all duration-200 hover:shadow-apple-md hover:-translate-y-0.5"
        >
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-apple-sm bg-apple-blue/10">
            <svg className="h-5 w-5 text-apple-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
          </div>
          <h2 className="text-apple-lg font-semibold text-apple-text mb-1">Locations</h2>
          <p className="text-apple-sm text-apple-text-secondary mb-5">
            View and manage all locations, including hours, booking rules, bays, and notifications.
          </p>
          <span className="text-apple-sm font-medium text-apple-blue group-hover:underline">
            Manage Locations →
          </span>
        </Link>

        <Link
          href="/admin/admins"
          className="card group p-6 transition-all duration-200 hover:shadow-apple-md hover:-translate-y-0.5"
        >
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-apple-sm bg-apple-green/10">
            <svg className="h-5 w-5 text-apple-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          </div>
          <h2 className="text-apple-lg font-semibold text-apple-text mb-1">Admins</h2>
          <p className="text-apple-sm text-apple-text-secondary mb-5">
            Manage admin accounts and control access to locations.
          </p>
          <span className="text-apple-sm font-medium text-apple-blue group-hover:underline">
            Manage Admins →
          </span>
        </Link>
      </div>

      {/* Footer */}
      <div className="text-apple-xs text-apple-text-tertiary pt-8 border-t border-apple-divider">
        Tee24 Admin Console © {new Date().getFullYear()}
      </div>
    </div>
  );
}
