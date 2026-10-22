"use client";

import React from "react";
import { useToast } from "@/components/ui/Toast";
import { Input } from "@/components/ui/Input";
import { SettingsSection, Field, Toggle } from "./SettingsSection";
import { clampInt, type LocationSettings } from "./useLocationSettings";

export function BayKioskSettings({
  data,
  saving,
  save,
}: {
  data: LocationSettings;
  saving: boolean;
  save: (patch: Partial<LocationSettings>) => Promise<LocationSettings>;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const fromData = React.useCallback(
    () => ({
      bayAppEnabled: Boolean(data.bayAppEnabled),
      bayAppUnlockMinutes: clampInt(data.bayAppUnlockMinutes, 1, 60, 10),
      bayAppWarningMinutes: clampInt(data.bayAppWarningMinutes, 1, 60, 10),
      bayAppAutoCancelOnTimeout: data.bayAppAutoCancelOnTimeout !== false,
    }),
    [data]
  );
  const [draft, setDraft] = React.useState(fromData);

  React.useEffect(() => {
    if (!editing) setDraft(fromData());
  }, [fromData, editing]);

  async function onSave() {
    try {
      await save({
        bayAppEnabled: draft.bayAppEnabled,
        bayAppUnlockMinutes: Number(draft.bayAppUnlockMinutes),
        bayAppWarningMinutes: Number(draft.bayAppWarningMinutes),
        bayAppAutoCancelOnTimeout: draft.bayAppAutoCancelOnTimeout,
      });
      setEditing(false);
      toast({ tone: "success", title: "Kiosk settings saved" });
    } catch (e: unknown) {
      toast({ tone: "error", title: "Couldn't save kiosk settings", description: e instanceof Error ? e.message : undefined });
    }
  }

  return (
    <SettingsSection
      title="Kiosk behavior"
      description="Controls the Tee24 Bay Kiosk app running on each bay computer."
      editing={editing}
      onEdit={() => setEditing(true)}
      onCancel={() => {
        setEditing(false);
        setDraft(fromData());
      }}
      onSave={onSave}
      saving={saving}
    >
      {!editing ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Kiosk enabled" value={data.bayAppEnabled ? "Yes" : "No"} />
          <Field label="Unlock window" value={`${clampInt(data.bayAppUnlockMinutes, 1, 60, 10)} minutes`} />
          <Field label="Upcoming reservation notice" value={`${clampInt(data.bayAppWarningMinutes, 1, 60, 10)} minutes before`} />
          <Field label="Auto-cancel if not unlocked" value={data.bayAppAutoCancelOnTimeout !== false ? "Yes" : "No"} />
        </div>
      ) : (
        <div className="space-y-5">
          <Toggle
            checked={draft.bayAppEnabled}
            onChange={(v) => setDraft((d) => ({ ...d, bayAppEnabled: v }))}
            label="Enable bay kiosk"
            hint="When a reservation starts the kiosk asks the member for their phone number to unlock the bay."
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Unlock window (minutes)"
              type="number"
              inputMode="numeric"
              min={1}
              max={60}
              value={draft.bayAppUnlockMinutes}
              onChange={(e) => setDraft((d) => ({ ...d, bayAppUnlockMinutes: Number(e.target.value) }))}
              hint="How long the unlock prompt stays on screen before it dismisses."
            />
            <Input
              label="Upcoming notice (minutes before)"
              type="number"
              inputMode="numeric"
              min={1}
              max={60}
              value={draft.bayAppWarningMinutes}
              onChange={(e) => setDraft((d) => ({ ...d, bayAppWarningMinutes: Number(e.target.value) }))}
              hint="When to warn the current player that a reservation is coming up."
            />
          </div>
          <Toggle
            checked={draft.bayAppAutoCancelOnTimeout}
            onChange={(v) => setDraft((d) => ({ ...d, bayAppAutoCancelOnTimeout: v }))}
            label="Auto-cancel reservation on timeout"
            hint="If nobody unlocks before the window ends, cancel the reservation so the bay frees up."
          />
        </div>
      )}
    </SettingsSection>
  );
}
