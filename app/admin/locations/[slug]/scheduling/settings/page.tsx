"use client";

import { useParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { BookingSettings } from "@/components/admin/location-settings/BookingSettings";
import { SettingsPageState } from "@/components/admin/location-settings/SettingsPageState";
import { useLocationSettings } from "@/components/admin/location-settings/useLocationSettings";

export default function BookingSettingsPage() {
  const params = useParams<{ slug: string }>();
  const slug = decodeURIComponent(params?.slug ?? "");
  const { data, loading, error, saving, save, reload } = useLocationSettings(slug);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Booking settings"
        description="How long people can book, how many reservations they can hold, and what happens when those rules conflict."
      />
      <SettingsPageState loading={loading} error={error} onRetry={reload}>
        {data && <BookingSettings data={data} saving={saving} save={save} />}
      </SettingsPageState>
    </div>
  );
}
