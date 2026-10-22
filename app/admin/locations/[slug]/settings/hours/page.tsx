"use client";

import { useParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { HoursSettings } from "@/components/admin/location-settings/HoursSettings";
import { SettingsPageState } from "@/components/admin/location-settings/SettingsPageState";
import { useLocationSettings } from "@/components/admin/location-settings/useLocationSettings";

export default function HoursSettingsPage() {
  const params = useParams<{ slug: string }>();
  const slug = decodeURIComponent(params?.slug ?? "");
  const { data, loading, error, saving, save, reload } = useLocationSettings(slug);

  return (
    <div className="space-y-6">
      <PageHeader title="Hours" description="When this location accepts bookings." />
      <SettingsPageState loading={loading} error={error} onRetry={reload}>
        {data && <HoursSettings data={data} saving={saving} save={save} />}
      </SettingsPageState>
    </div>
  );
}
