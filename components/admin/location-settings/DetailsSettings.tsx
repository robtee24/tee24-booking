"use client";

import React from "react";
import { useToast } from "@/components/ui/Toast";
import { Input, Select } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { SettingsSection, Field, Toggle } from "./SettingsSection";
import type { LocationSettings } from "./useLocationSettings";

/** Mirrors COMMON_TIMEZONES in services/location.service.ts (kept client-safe). */
const COMMON_TIMEZONES: { value: string; label: string }[] = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Phoenix", label: "Arizona (Phoenix, no DST)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
  { value: "America/Puerto_Rico", label: "Atlantic (Puerto Rico)" },
  { value: "America/Toronto", label: "Eastern (Toronto)" },
  { value: "America/Vancouver", label: "Pacific (Vancouver)" },
  { value: "Europe/London", label: "UK (London)" },
  { value: "UTC", label: "UTC" },
];

const COUNTRIES = [
  { value: "US", label: "United States" },
  { value: "CA", label: "Canada" },
  { value: "GB", label: "United Kingdom" },
  { value: "AU", label: "Australia" },
  { value: "MX", label: "Mexico" },
];

type Draft = {
  businessName: string;
  phone: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  timezone: string;
  logoUrl: string;
  disabled: boolean;
  latitude: string;
  longitude: string;
  unlockRadiusMeters: string;
};

function fromData(d: LocationSettings): Draft {
  return {
    businessName: d.businessName ?? "",
    phone: d.phone ?? "",
    email: d.email ?? "",
    addressLine1: d.addressLine1 ?? "",
    addressLine2: d.addressLine2 ?? "",
    city: d.city ?? "",
    state: d.state ?? "",
    zip: d.zip ?? "",
    country: d.country ?? "US",
    timezone: d.timezone ?? "America/New_York",
    logoUrl: d.logoUrl ?? "",
    disabled: Boolean(d.disabled),
    latitude: d.latitude != null ? String(d.latitude) : "",
    longitude: d.longitude != null ? String(d.longitude) : "",
    unlockRadiusMeters: String(d.unlockRadiusMeters ?? 150),
  };
}

export function DetailsSettings({
  data,
  saving,
  save,
  canDisable = true,
}: {
  data: LocationSettings;
  saving: boolean;
  save: (patch: Partial<LocationSettings>) => Promise<LocationSettings>;
  /** ROOT/FULL only — scoped admins see the toggle read-only. */
  canDisable?: boolean;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const [d, setD] = React.useState<Draft>(() => fromData(data));
  const [customTz, setCustomTz] = React.useState(false);

  React.useEffect(() => {
    if (!editing) setD(fromData(data));
  }, [data, editing]);

  const tzIsCommon = COMMON_TIMEZONES.some((t) => t.value === d.timezone);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  async function onSave() {
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) return toast({ tone: "error", title: "Email address is invalid" });
    if (d.logoUrl && !/^https?:\/\//i.test(d.logoUrl.trim())) return toast({ tone: "error", title: "Logo URL must start with http:// or https://" });
    const lat = d.latitude.trim() ? Number(d.latitude) : null;
    const lng = d.longitude.trim() ? Number(d.longitude) : null;
    if ((lat == null) !== (lng == null)) return toast({ tone: "error", title: "Enter both latitude and longitude, or neither" });
    if (lat != null && (!Number.isFinite(lat) || Math.abs(lat) > 90)) return toast({ tone: "error", title: "Latitude must be between -90 and 90" });
    if (lng != null && (!Number.isFinite(lng) || Math.abs(lng) > 180)) return toast({ tone: "error", title: "Longitude must be between -180 and 180" });
    const radius = Number(d.unlockRadiusMeters);
    if (!Number.isFinite(radius) || radius < 25 || radius > 5000) return toast({ tone: "error", title: "Unlock radius must be between 25 and 5000 meters" });
    try {
      const patch: Partial<LocationSettings> = {
        businessName: d.businessName.trim() || null,
        phone: d.phone.trim() || null,
        email: d.email.trim() || null,
        addressLine1: d.addressLine1.trim() || null,
        addressLine2: d.addressLine2.trim() || null,
        city: d.city.trim() || null,
        state: d.state.trim() || null,
        zip: d.zip.trim() || null,
        country: d.country.trim() || null,
        timezone: d.timezone.trim(),
        logoUrl: d.logoUrl.trim() || null,
        latitude: lat,
        longitude: lng,
        unlockRadiusMeters: Math.round(radius),
      };
      if (canDisable) patch.disabled = d.disabled;
      await save(patch);
      setEditing(false);
      toast({ tone: "success", title: "Details saved" });
    } catch (e: unknown) {
      toast({ tone: "error", title: "Couldn't save details", description: e instanceof Error ? e.message : undefined });
    }
  }

  const address = [data.addressLine1, data.addressLine2, [data.city, data.state].filter(Boolean).join(", "), data.zip, data.country].filter(Boolean);

  return (
    <SettingsSection
      title="Details"
      description="Business identity, contact info, and address used on receipts, invoices, emails, and the member portal."
      editing={editing}
      onEdit={() => setEditing(true)}
      onCancel={() => setEditing(false)}
      onSave={onSave}
      saving={saving}
    >
      {!editing ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Business name" value={data.businessName} />
          <Field label="Phone" value={data.phone} mono />
          <Field label="Email" value={data.email} />
          <div className="sm:col-span-2 lg:col-span-1">
            <Field
              label="Address"
              value={address.length ? address.map((line, i) => <span key={i} className="block">{line}</span>) : null}
            />
          </div>
          <Field label="Timezone" value={COMMON_TIMEZONES.find((t) => t.value === data.timezone)?.label ?? data.timezone} />
          <Field
            label="Logo"
            value={
              data.logoUrl ? (
                <span className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={data.logoUrl} alt="" className="h-8 w-8 rounded-apple-sm border border-apple-border object-contain" />
                  <span className="truncate font-mono text-apple-xs text-apple-text-secondary">{data.logoUrl}</span>
                </span>
              ) : null
            }
          />
          <Field label="Status" value={data.disabled ? <Badge tone="danger" size="sm">Disabled</Badge> : <Badge tone="success" size="sm">Live</Badge>} />
          <Field
            label="App unlock geofence"
            value={
              data.latitude != null && data.longitude != null ? (
                <span>
                  <span className="font-mono text-apple-xs">{data.latitude}, {data.longitude}</span>
                  <span className="text-apple-text-secondary"> · within {data.unlockRadiusMeters ?? 150} m</span>
                </span>
              ) : (
                <Badge tone="warn" size="sm">Not set — app unlocks disabled</Badge>
              )
            }
          />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Business name" value={d.businessName} onChange={(e) => set("businessName", e.target.value)} placeholder="Tee24 Clarksville LLC" hint="Legal/trading name shown on receipts." />
            <Input label="Phone" type="tel" value={d.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+1 (931) 555-0100" className="font-mono" />
            <Input label="Email" type="email" value={d.email} onChange={(e) => set("email", e.target.value)} placeholder="clarksville@tee24.golf" />
            <Input label="Logo URL" type="url" value={d.logoUrl} onChange={(e) => set("logoUrl", e.target.value)} placeholder="https://…/logo.png" className="font-mono" />
          </div>

          <div>
            <div className="mb-2 text-apple-xs font-semibold uppercase tracking-wider text-apple-text-tertiary">Address</div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
              <div className="sm:col-span-4"><Input label="Address line 1" value={d.addressLine1} onChange={(e) => set("addressLine1", e.target.value)} /></div>
              <div className="sm:col-span-2"><Input label="Line 2" value={d.addressLine2} onChange={(e) => set("addressLine2", e.target.value)} placeholder="Suite" /></div>
              <div className="sm:col-span-3"><Input label="City" value={d.city} onChange={(e) => set("city", e.target.value)} /></div>
              <div className="sm:col-span-1"><Input label="State" value={d.state} onChange={(e) => set("state", e.target.value.toUpperCase())} maxLength={3} /></div>
              <div className="sm:col-span-2"><Input label="ZIP / Postal" value={d.zip} onChange={(e) => set("zip", e.target.value)} className="font-mono" /></div>
              <div className="sm:col-span-3">
                <Select label="Country" value={d.country} onChange={(e) => set("country", e.target.value)}>
                  {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  {!COUNTRIES.some((c) => c.value === d.country) && d.country && <option value={d.country}>{d.country}</option>}
                </Select>
              </div>
              <div className="sm:col-span-3">
                {customTz || !tzIsCommon ? (
                  <div>
                    <Input
                      label="Timezone (IANA)"
                      value={d.timezone}
                      onChange={(e) => set("timezone", e.target.value)}
                      placeholder="America/New_York"
                      className="font-mono"
                    />
                    <button
                      type="button"
                      className="mt-1 text-apple-xs text-apple-blue hover:underline"
                      onClick={() => {
                        setCustomTz(false);
                        if (!tzIsCommon) set("timezone", "America/New_York");
                      }}
                    >
                      Choose from common zones
                    </button>
                  </div>
                ) : (
                  <Select
                    label="Timezone"
                    value={d.timezone}
                    onChange={(e) => {
                      if (e.target.value === "__custom__") setCustomTz(true);
                      else set("timezone", e.target.value);
                    }}
                    hint="Bookings, hours, and reports use this zone."
                  >
                    {COMMON_TIMEZONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    <option value="__custom__">Other (enter IANA name)…</option>
                  </Select>
                )}
              </div>
            </div>
          </div>

          <div>
            <div className="mb-2 text-apple-xs font-semibold uppercase tracking-wider text-apple-text-tertiary">Member app · door unlock geofence</div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input label="Latitude" value={d.latitude} onChange={(e) => set("latitude", e.target.value)} placeholder="36.5298" className="font-mono" inputMode="decimal" />
              <Input label="Longitude" value={d.longitude} onChange={(e) => set("longitude", e.target.value)} placeholder="-87.3595" className="font-mono" inputMode="decimal" />
              <Input label="Unlock radius (m)" type="number" min="25" max="5000" value={d.unlockRadiusMeters} onChange={(e) => set("unlockRadiusMeters", e.target.value)} hint="Members must be within this distance to unlock. 150 m is a good default." />
            </div>
            <p className="mt-2 text-apple-xs text-apple-text-tertiary">Right-click the front door in Google Maps and copy the coordinates. Leave blank to disable unlocking from the app at this location.</p>
          </div>

          <Toggle
            checked={d.disabled}
            onChange={(v) => canDisable && set("disabled", v)}
            label="Location disabled"
            hint={canDisable ? "Hides the location from public booking and the location switcher. Data is kept." : "Only ROOT/FULL admins can change this."}
          />
        </div>
      )}
    </SettingsSection>
  );
}
