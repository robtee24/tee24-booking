// app/admin/locations/[slug]/layout.tsx
'use client';

import { PropsWithChildren } from 'react';

export default function LocationLayout({ children }: PropsWithChildren) {
  // No secondary sidebar here; the parent /admin layout already shows
  // the Locations subtree (Details, Bays, Notifications, Bookings).
  // This keeps the top-level navigation intact.
  return <>{children}</>;
}