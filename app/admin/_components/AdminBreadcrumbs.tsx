'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

function titleize(s: string) {
  // keep slugs like "clarksville" as-is, title-case other segments
  if (!s) return s;
  if (/^[a-z0-9-]+$/.test(s)) return s; // sluggy: leave alone
  return s
    .split(/[-_]/g)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export default function AdminBreadcrumbs() {
  const pathname = usePathname() || '/admin';

  // Ensure we’re always operating under /admin
  // e.g. /admin/locations/clarksville/notifications
  const parts = pathname.split('/').filter(Boolean);
  const adminIdx = parts.indexOf('admin');
  const trail = adminIdx >= 0 ? parts.slice(adminIdx) : ['admin'];

  // Build breadcrumb items with correct hrefs rooted at /admin
  const items = trail.map((seg, i) => {
    const href = '/' + trail.slice(0, i + 1).join('/');
    const label = seg === 'admin' ? 'Admin' : titleize(seg);
    return { href, label };
  });

  return (
    <nav aria-label="Breadcrumb" className="text-sm text-gray-600">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={item.href} className="flex items-center">
              {!isLast ? (
                <>
                  <Link
                    href={item.href}
                    className="hover:text-gray-900 underline-offset-2 hover:underline"
                  >
                    {item.label}
                  </Link>
                  <span className="mx-2 text-gray-400">/</span>
                </>
              ) : (
                <span className="font-medium text-gray-900">{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
