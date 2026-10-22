"use client";

import React from "react";

export type AdminLocationContextValue = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  disabled: boolean;
};

const Ctx = React.createContext<AdminLocationContextValue | null>(null);

/** Provided by `app/admin/locations/[slug]/layout.tsx` after the slug is validated server-side. */
export function AdminLocationProvider({
  value,
  children,
}: {
  value: AdminLocationContextValue;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Current location for pages under /admin/locations/[slug]. Throws outside that tree. */
export function useAdminLocation(): AdminLocationContextValue {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useAdminLocation must be used under /admin/locations/[slug]");
  return v;
}

/** Nullable variant for components that may render inside or outside a location. */
export function useOptionalAdminLocation(): AdminLocationContextValue | null {
  return React.useContext(Ctx);
}
