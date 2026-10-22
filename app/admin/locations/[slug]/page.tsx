// app/admin/locations/[slug]/page.tsx
"use client";

import Link from "next/link";
import React from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronRight, Clock, MonitorSmartphone } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Input, Textarea, Select } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { adminRoutes } from "@/lib/admin/routes";
import { SettingsSection, Field } from "@/components/admin/location-settings/SettingsSection";
import { useLocationSettings, clampInt, type LocationSettings } from "@/components/admin/location-settings/useLocationSettings";
import { SettingsPageState } from "@/components/admin/location-settings/SettingsPageState";

export default function LocationDetailsPage() {
  const params = useParams<{ slug: string }>();
  const slug = decodeURIComponent(params?.slug ?? "");
  const { data, loading, error, saving, save, reload } = useLocationSettings(slug);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Location details"
        description={data ? `Overview and booking settings for ${data.name}.` : "Overview and booking settings."}
        meta={data?.updatedAt ? `Updated ${new Date(data.updatedAt).toLocaleString()}` : undefined}
      />

      <SettingsPageState loading={loading} error={error} onRetry={reload}>
        {data && (
          <>
            <OverviewSection data={data} saving={saving} save={save} />
            <BookingNoteSection data={data} saving={saving} save={save} />
            <PassUrlSection data={data} saving={saving} save={save} />
            <BookingRulesSection data={data} saving={saving} save={save} />

            <div className="grid gap-3 sm:grid-cols-2">
              <QuickLink
                href={adminRoutes.loc.settings.hours(data.slug)}
                icon={<Clock className="h-5 w-5" />}
                title="Hours of operation"
                description={data.open24Hours ? "Open 24 hours" : "Weekly schedule"}
              />
              <QuickLink
                href={adminRoutes.loc.settings.bayApp(data.slug)}
                icon={<MonitorSmartphone className="h-5 w-5" />}
                title="Bay kiosk"
                description={data.bayAppEnabled ? "Enabled on bay computers" : "Not enabled"}
              />
            </div>
          </>
        )}
      </SettingsPageState>
    </div>
  );
}

type SectionProps = {
  data: LocationSettings;
  saving: boolean;
  save: (patch: Partial<LocationSettings>, opts?: { locationSlug?: string }) => Promise<LocationSettings>;
};

/* ───────────────────────────── Overview ────────────────────────────────── */

function OverviewSection({ data, saving, save }: SectionProps) {
  const { toast } = useToast();
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(data.name);
  const [slug, setSlug] = React.useState(data.slug);

  React.useEffect(() => {
    if (!editing) {
      setName(data.name);
      setSlug(data.slug);
    }
  }, [data.name, data.slug, editing]);

  async function onSave() {
    const nextSlug = slug.trim();
    if (!name.trim()) return toast({ tone: "error", title: "Name is required" });
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(nextSlug)) {
      return toast({ tone: "error", title: "Slug must be lowercase letters, numbers, and dashes" });
    }
    try {
      const prevSlug = data.slug;
      const updated = await save({ name: name.trim(), slug: nextSlug }, { locationSlug: prevSlug });
      setEditing(false);
      toast({ tone: "success", title: "Overview saved" });
      if (updated.slug !== prevSlug) router.replace(adminRoutes.loc.root(updated.slug));
    } catch (e: unknown) {
      toast({ tone: "error", title: "Couldn't save overview", description: e instanceof Error ? e.message : undefined });
    }
  }

  return (
    <SettingsSection
      title="Overview"
      editing={editing}
      onEdit={() => setEditing(true)}
      onCancel={() => setEditing(false)}
      onSave={onSave}
      saving={saving}
    >
      {!editing ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name" value={data.name} />
          <Field label="Slug" value={data.slug} mono />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Location name" />
          <Input
            label="Slug"
            className="font-mono"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            hint="Used in URLs. Changing it updates every admin and booking link."
          />
        </div>
      )}
    </SettingsSection>
  );
}

/* ───────────────────────────── Booking note ────────────────────────────── */

function BookingNoteSection({ data, saving, save }: SectionProps) {
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const [note, setNote] = React.useState(data.bookingNote ?? "");
  React.useEffect(() => {
    if (!editing) setNote(data.bookingNote ?? "");
  }, [data.bookingNote, editing]);

  async function onSave() {
    try {
      await save({ bookingNote: note });
      setEditing(false);
      toast({ tone: "success", title: "Booking note saved" });
    } catch (e: unknown) {
      toast({ tone: "error", title: "Couldn't save note", description: e instanceof Error ? e.message : undefined });
    }
  }

  return (
    <SettingsSection
      title="Booking note"
      description="Included in booking confirmations."
      editing={editing}
      onEdit={() => setEditing(true)}
      onCancel={() => setEditing(false)}
      onSave={onSave}
      saving={saving}
    >
      {!editing ? (
        data.bookingNote ? (
          <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-apple-sm border border-apple-border bg-apple-fill-secondary p-3 text-apple-sm leading-5 text-apple-text-secondary">
            {data.bookingNote}
          </pre>
        ) : (
          <p className="text-apple-sm text-apple-text-tertiary">No note yet.</p>
        )
      ) : (
        <Textarea rows={6} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note to include in booking confirmations…" />
      )}
    </SettingsSection>
  );
}

/* ───────────────────────────── Pass URL ────────────────────────────────── */

function PassUrlSection({ data, saving, save }: SectionProps) {
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const [url, setUrl] = React.useState(data.passAccessUrl ?? "");
  React.useEffect(() => {
    if (!editing) setUrl(data.passAccessUrl ?? "");
  }, [data.passAccessUrl, editing]);

  async function onSave() {
    const v = url.trim();
    if (v && !/^https?:\/\//i.test(v)) return toast({ tone: "error", title: "URL must start with http:// or https://" });
    try {
      await save({ passAccessUrl: v || null });
      setEditing(false);
      toast({ tone: "success", title: "Pass URL saved" });
    } catch (e: unknown) {
      toast({ tone: "error", title: "Couldn't save URL", description: e instanceof Error ? e.message : undefined });
    }
  }

  return (
    <SettingsSection
      title="Pass access URL"
      description='If set, guests see a "Buy Passes" button on the booking confirmation page.'
      editing={editing}
      onEdit={() => setEditing(true)}
      onCancel={() => setEditing(false)}
      onSave={onSave}
      saving={saving}
    >
      {!editing ? (
        <Field label="URL" value={data.passAccessUrl} mono />
      ) : (
        <Input type="url" className="font-mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-site.com/passes (optional)" />
      )}
    </SettingsSection>
  );
}

/* ───────────────────────────── Booking rules ───────────────────────────── */

const DURATIONS = Array.from({ length: 24 }, (_, i) => (i + 1) * 30);

function BookingRulesSection({ data, saving, save }: SectionProps) {
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const fromData = React.useCallback(
    () => ({
      minBookingMinutes: clampInt(data.minBookingMinutes, 30, 720, 60),
      maxBookingMinutes: clampInt(data.maxBookingMinutes, 30, 720, 120),
      maxActiveBookingsPerGuest: clampInt(data.maxActiveBookingsPerGuest, 0, 20, 2),
      activeBookingIdentifyBy: (data.activeBookingIdentifyBy ?? "either") as "phone" | "email" | "either",
      activeBookingWindowHours: clampInt(data.activeBookingWindowHours, 1, 720, 24),
      maxConsecutiveBookingsPerGuest: clampInt(data.maxConsecutiveBookingsPerGuest, 1, 10, 2),
    }),
    [data]
  );
  const [d, setD] = React.useState(fromData);
  React.useEffect(() => {
    if (!editing) setD(fromData());
  }, [fromData, editing]);

  async function onSave() {
    if (d.minBookingMinutes > d.maxBookingMinutes) {
      return toast({ tone: "error", title: "Minimum duration must be ≤ maximum duration" });
    }
    try {
      await save({ ...d });
      setEditing(false);
      toast({ tone: "success", title: "Booking rules saved" });
    } catch (e: unknown) {
      toast({ tone: "error", title: "Couldn't save rules", description: e instanceof Error ? e.message : undefined });
    }
  }

  const idLabel = { either: "Either email or phone", email: "Email", phone: "Phone" } as const;

  return (
    <SettingsSection
      title="Booking rules"
      description="Limits that apply to public bookings at this location."
      editing={editing}
      onEdit={() => setEditing(true)}
      onCancel={() => setEditing(false)}
      onSave={onSave}
      saving={saving}
    >
      {!editing ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Min duration" value={fmtMinutes(clampInt(data.minBookingMinutes, 30, 720, 60))} />
          <Field label="Max duration" value={fmtMinutes(clampInt(data.maxBookingMinutes, 30, 720, 120))} />
          <Field label="Max active bookings / guest" value={String(clampInt(data.maxActiveBookingsPerGuest, 0, 20, 2))} />
          <Field label="Identify guest by" value={idLabel[(data.activeBookingIdentifyBy ?? "either") as keyof typeof idLabel]} />
          <Field label="Active window" value={`${clampInt(data.activeBookingWindowHours, 1, 720, 24)} hours`} />
          <Field label="Max consecutive / guest" value={String(clampInt(data.maxConsecutiveBookingsPerGuest, 1, 10, 2))} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Minimum booking duration" value={d.minBookingMinutes} onChange={(e) => setD((p) => ({ ...p, minBookingMinutes: Number(e.target.value) }))}>
            {DURATIONS.map((m) => (
              <option key={m} value={m}>{fmtMinutes(m)}</option>
            ))}
          </Select>
          <Select label="Maximum booking duration" value={d.maxBookingMinutes} onChange={(e) => setD((p) => ({ ...p, maxBookingMinutes: Number(e.target.value) }))}>
            {DURATIONS.map((m) => (
              <option key={m} value={m}>{fmtMinutes(m)}</option>
            ))}
          </Select>
          <Input label="Max active bookings per guest" type="number" inputMode="numeric" min={0} max={20} value={d.maxActiveBookingsPerGuest} onChange={(e) => setD((p) => ({ ...p, maxActiveBookingsPerGuest: Number(e.target.value) }))} />
          <Select label="Identify guest by" value={d.activeBookingIdentifyBy} onChange={(e) => setD((p) => ({ ...p, activeBookingIdentifyBy: e.target.value as "phone" | "email" | "either" }))}>
            <option value="either">Either email or phone</option>
            <option value="email">Email</option>
            <option value="phone">Phone</option>
          </Select>
          <Input label="Active bookings window (hours)" type="number" inputMode="numeric" min={1} max={720} value={d.activeBookingWindowHours} onChange={(e) => setD((p) => ({ ...p, activeBookingWindowHours: Number(e.target.value) }))} />
          <Input label="Max consecutive bookings per guest" type="number" inputMode="numeric" min={1} max={10} value={d.maxConsecutiveBookingsPerGuest} onChange={(e) => setD((p) => ({ ...p, maxConsecutiveBookingsPerGuest: Number(e.target.value) }))} />
        </div>
      )}
    </SettingsSection>
  );
}

/* ───────────────────────────── bits ─────────────────────────────────────── */

function QuickLink({ href, icon, title, description }: { href: string; icon: React.ReactNode; title: string; description: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-apple border border-apple-divider bg-white p-4 shadow-apple transition-colors hover:border-apple-blue/40"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-apple-sm bg-apple-blue/10 text-apple-blue">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-apple-sm font-semibold text-apple-text">{title}</span>
        <span className="block truncate text-apple-xs text-apple-text-secondary">{description}</span>
      </span>
      <ChevronRight className="h-4 w-4 text-apple-text-tertiary" />
    </Link>
  );
}

function fmtMinutes(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h}h`;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}
