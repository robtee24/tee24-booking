// app/admin/locations/[slug]/page.tsx
"use client";

import Link from "next/link";
import React from "react";
import { useParams, useRouter } from "next/navigation";
import { CalendarDays, ChevronRight, Clock, MonitorSmartphone } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Input, Textarea } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { adminRoutes } from "@/lib/admin/routes";
import { SettingsSection, Field } from "@/components/admin/location-settings/SettingsSection";
import { useLocationSettings, type LocationSettings } from "@/components/admin/location-settings/useLocationSettings";
import { SettingsPageState } from "@/components/admin/location-settings/SettingsPageState";
import { DetailsSettings } from "@/components/admin/location-settings/DetailsSettings";

export default function LocationDetailsPage() {
  const params = useParams<{ slug: string }>();
  const slug = decodeURIComponent(params?.slug ?? "");
  const { data, loading, error, saving, save, reload } = useLocationSettings(slug);
  const [role, setRole] = React.useState<"ROOT" | "FULL" | "SCOPED" | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/auth/session", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => !cancelled && setRole(j?.role ?? null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Location details"
        description={data ? `Identity and contact for ${data.name}.` : "Identity and contact for this location."}
        meta={data?.updatedAt ? `Updated ${new Date(data.updatedAt).toLocaleString()}` : undefined}
      />

      <SettingsPageState loading={loading} error={error} onRetry={reload}>
        {data && (
          <>
            <OverviewSection data={data} saving={saving} save={save} />
            <DetailsSettings data={data} saving={saving} save={save} canDisable={role === "ROOT" || role === "FULL"} />
            <BookingNoteSection data={data} saving={saving} save={save} />
            <PassUrlSection data={data} saving={saving} save={save} />

            <div className="grid gap-3 sm:grid-cols-2">
              <QuickLink
                href={adminRoutes.loc.scheduling.settings(data.slug)}
                icon={<CalendarDays className="h-5 w-5" />}
                title="Booking settings"
                description="Duration, active reservations, and back-to-back limits"
              />
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

