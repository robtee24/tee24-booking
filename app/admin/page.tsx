// app/admin/page.tsx
import Link from 'next/link';

export default function AdminHomePage() {
  return (
    <div className="flex flex-col gap-8 p-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Admin Dashboard</h1>
          <p className="text-sm text-gray-600">
            Manage your Tee24 locations, notifications, bays, bookings, and admins.
          </p>
        </div>
      </div>

      {/* Cards / Quick Actions */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {/* Locations */}
        <Link
          href="/admin/locations"
          className="rounded-xl border p-6 shadow-sm transition hover:shadow-md hover:border-gray-400 bg-white"
        >
          <h2 className="text-lg font-medium text-gray-900 mb-1">Locations</h2>
          <p className="text-sm text-gray-600 mb-4">
            View and manage all locations, including hours, booking rules, bays, and notifications.
          </p>
          <span className="inline-block rounded bg-black px-3 py-1 text-xs text-white">
            Manage Locations
          </span>
        </Link>

        {/* Admins */}
        <Link
          href="/admin/admins"
          className="rounded-xl border p-6 shadow-sm transition hover:shadow-md hover:border-gray-400 bg-white"
        >
          <h2 className="text-lg font-medium text-gray-900 mb-1">Admins</h2>
          <p className="text-sm text-gray-600 mb-4">
            Manage admin accounts and control access to locations.
          </p>
          <span className="inline-block rounded bg-black px-3 py-1 text-xs text-white">
            Manage Admins
          </span>
        </Link>
      </div>

      {/* Footer note */}
      <div className="text-xs text-gray-500 pt-8 border-t">
        Tee24 Admin Console © {new Date().getFullYear()}
      </div>
    </div>
  );
}


