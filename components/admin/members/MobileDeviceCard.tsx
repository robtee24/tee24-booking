"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellOff, BellRing, Smartphone, Unlock } from "lucide-react";
import { Badge, Button, Modal, useToast } from "@/components/ui";
import { adminRoutes } from "@/lib/admin/routes";
import { api, errMsg } from "./shared";

export type DeviceInfo = {
  id: string;
  platform: string;
  name: string | null;
  model: string | null;
  osVersion: string | null;
  appVersion: string | null;
  boundAt: string;
  lastSeenAt: string | null;
  pushEnabled?: boolean;
  pushPermission?: string | null;
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

export function MobileDeviceCard({ memberId, firstName, device, pendingRequests, liveSessions }: { memberId: string; firstName: string; device: DeviceInfo | null; pendingRequests: number; liveSessions: number }) {
  const router = useRouter();
  const { toast } = useToast();
  const [confirm, setConfirm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function unlock() {
    setBusy(true);
    try {
      await api(`/api/admin/mobile/devices`, { method: "DELETE", json: { memberId } });
      toast({ tone: "success", title: "Device unlocked", description: `${firstName} can now sign in to the app on any phone.` });
      setConfirm(false);
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't unlock device", description: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  if (!device) {
    return (
      <div className="text-apple-sm text-apple-text-secondary">
        <div className="flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-apple-text-tertiary" />
          Not signed in to the app yet.
        </div>
        <div className="mt-1 flex items-center gap-2 text-apple-xs text-apple-text-tertiary">
          <BellOff className="h-3.5 w-3.5" /> Notifications reach {firstName} by text message.
        </div>
        {pendingRequests > 0 && (
          <Link href={adminRoutes.mobileApp()} className="mt-2 inline-block text-apple-blue hover:underline">
            {pendingRequests} pending new-phone request →
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="text-apple-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-medium text-apple-text">
            <Smartphone className="h-4 w-4 text-apple-text-tertiary" />
            {device.name || device.model || (device.platform === "android" ? "Android phone" : "iPhone")}
          </div>
          <div className="mt-1 text-apple-xs text-apple-text-secondary">
            {device.platform === "android" ? "Android" : "iOS"}
            {device.osVersion ? ` ${device.osVersion}` : ""}
            {device.model && device.name ? ` · ${device.model}` : ""}
            {device.appVersion ? ` · app ${device.appVersion}` : ""}
          </div>
          <div className="mt-1 text-apple-xs text-apple-text-tertiary">
            Bound {fmt(device.boundAt)} · last seen {fmt(device.lastSeenAt)}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-apple-xs text-apple-text-secondary">
            {device.pushEnabled ? (
              <>
                <BellRing className="h-3.5 w-3.5 text-apple-green" /> Push notifications on — texts are delivered as app notifications.
              </>
            ) : (
              <>
                <BellOff className="h-3.5 w-3.5 text-apple-text-tertiary" />
                {device.pushPermission === "denied" ? "Push notifications declined — falls back to text message." : "Push not set up yet — falls back to text message."}
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={liveSessions > 0 ? "success" : "muted"} size="sm">{liveSessions > 0 ? "Signed in" : "Signed out"}</Badge>
          <Badge tone={device.pushEnabled ? "info" : "muted"} size="sm">{device.pushEnabled ? "Push" : "SMS"}</Badge>
        </div>
      </div>
      {pendingRequests > 0 && (
        <Link href={adminRoutes.mobileApp()} className="mt-2 inline-block text-apple-xs text-apple-blue hover:underline">
          {pendingRequests} pending new-phone request →
        </Link>
      )}
      <div className="mt-3">
        <Button variant="secondary" size="sm" iconLeft={<Unlock className="h-3.5 w-3.5" />} onClick={() => setConfirm(true)}>
          Unlock device
        </Button>
      </div>
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Unlock device"
        description={`${firstName} will be signed out of this phone and can sign in on any phone. Nothing else about the account changes.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button loading={busy} iconLeft={<Unlock className="h-3.5 w-3.5" />} onClick={unlock}>Unlock device</Button>
          </>
        }
      >
        <p className="text-apple-sm text-apple-text-secondary">Use this when a member lost or replaced their phone.</p>
      </Modal>
    </div>
  );
}
