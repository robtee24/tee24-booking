import Link from "next/link";
import { SearchX } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";

/**
 * Admin-scoped 404. Rendered (inside the admin shell) for:
 *  - unknown /admin/* URLs (via app/admin/[...missing]/page.tsx)
 *  - notFound() calls from admin pages/layouts (e.g. unknown location slug)
 */
export default function AdminNotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-apple-fill-secondary text-apple-text-tertiary">
        <SearchX className="h-7 w-7" />
      </div>
      <h1 className="text-apple-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-apple-base text-apple-text-secondary">
        That admin page doesn&apos;t exist or has moved. Use the navigation to find what you need.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Link href={adminRoutes.home()} className="btn-primary">
          Go to overview
        </Link>
        <Link href={adminRoutes.locations()} className="btn-secondary">
          All locations
        </Link>
      </div>
    </div>
  );
}
