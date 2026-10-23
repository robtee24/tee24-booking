"use client";

import React from "react";

export type DayHours = { day: number; closed?: boolean; open?: string; close?: string };

export type LocationSettings = {
  id: string;
  name: string;
  slug: string;
  disabled?: boolean | null;
  businessName?: string | null;
  phone?: string | null;
  email?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  timezone?: string | null;
  logoUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  unlockRadiusMeters?: number | null;
  bookingNote?: string | null;
  passAccessUrl?: string | null;
  open24Hours?: boolean | null;
  hours?: DayHours[] | null;
  minBookingMinutes?: number | null;
  maxBookingMinutes?: number | null;
  maxActiveBookingsPerGuest?: number | null;
  activeBookingIdentifyBy?: "phone" | "email" | "either" | null;
  activeBookingWindowHours?: number | null;
  maxConsecutiveBookingsPerGuest?: number | null;
  bayAppEnabled?: boolean | null;
  bayAppUnlockMinutes?: number | null;
  bayAppWarningMinutes?: number | null;
  bayAppAutoCancelOnTimeout?: boolean | null;
  updatedAt?: string | null;
};

type Patch = Partial<Omit<LocationSettings, "id">>;

/**
 * Load + patch `/api/admin/location-settings` for a location slug.
 * `save()` sends a partial patch and merges the response into local state.
 */
export function useLocationSettings(slug: string) {
  const [data, setData] = React.useState<LocationSettings | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/location-settings?locationSlug=${encodeURIComponent(slug)}`, { cache: "no-store" });
      if (!res.ok) throw await errorFromResponse(res, "Failed to load settings");
      const json = await res.json();
      setData(json?.settings ?? json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  React.useEffect(() => {
    void load();
  }, [load]);

  /** PATCH a partial payload; returns the updated settings or throws. */
  const save = React.useCallback(
    async (patch: Patch, opts?: { locationSlug?: string }): Promise<LocationSettings> => {
      const current = data;
      if (!current) throw new Error("Settings not loaded");
      setSaving(true);
      try {
        const res = await fetch("/api/admin/location-settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locationSlug: opts?.locationSlug ?? current.slug, ...patch }),
        });
        if (!res.ok) throw await errorFromResponse(res, "Save failed");
        const json = await res.json().catch(() => ({}));
        const updated: Partial<LocationSettings> = json?.settings ?? json ?? {};
        const next: LocationSettings = { ...current, ...patch, ...updated, updatedAt: new Date().toISOString() } as LocationSettings;
        setData(next);
        return next;
      } finally {
        setSaving(false);
      }
    },
    [data]
  );

  return { data, loading, error, saving, save, reload: load };
}

export async function errorFromResponse(res: Response, fallback: string): Promise<Error> {
  try {
    const text = await res.text();
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = j?.error ?? j?.message ?? text;
    } catch {}
    return new Error(`${fallback}${msg ? `: ${msg}` : ` (${res.status})`}`);
  } catch {
    return new Error(`${fallback} (${res.status})`);
  }
}

/** Clamp a number-ish value into [min,max], defaulting when invalid. */
export function clampInt(v: unknown, min: number, max: number, def: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}
