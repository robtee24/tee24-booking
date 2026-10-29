"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Search, Smartphone, Unlock, X } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Input, Modal, StatusBadge, Textarea, useToast } from "@/components/ui";
import { adminRoutes } from "@/lib/admin/routes";

export type MemberLite = { id: string; firstName: string; lastName: string; phone: string; email: string | null; locationSlug: string; locationName: string };
export type TransferDTO = {
  id: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  memberNote: string | null;
  toDeviceName: string | null;
  toDeviceModel: string | null;
  toPlatform: string;
  member: MemberLite;
};
export type DeviceDTO = {
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
  member: MemberLite;
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const fmtPhone = (p: string) => {
  const d = p.replace(/\D/g, "").replace(/^1/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
};
const deviceLabel = (name: string | null, model: string | null, platform: string) => name || model || (platform === "android" ? "Android phone" : "iPhone");

export function MobileAppClient({ pending, recent, devices: initialDevices, highlightRequestId }: { pending: TransferDTO[]; recent: TransferDTO[]; devices: DeviceDTO[]; highlightRequestId: string | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [deny, setDeny] = React.useState<TransferDTO | null>(null);
  const [denyNote, setDenyNote] = React.useState("");
  const [unlocking, setUnlocking] = React.useState<DeviceDTO | null>(null);
  const [q, setQ] = React.useState("");
  const [devices, setDevices] = React.useState(initialDevices);
  const [searching, setSearching] = React.useState(false);
  React.useEffect(() => setDevices(initialDevices), [initialDevices]);

  React.useEffect(() => {
    if (!highlightRequestId) return;
    document.getElementById(`req-${highlightRequestId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightRequestId]);

  async function decide(r: TransferDTO, action: "approve" | "deny", note?: string) {
    setBusy(r.id);
    try {
      const res = await fetch("/api/admin/mobile/transfer-requests", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, action, note }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      toast({ tone: "success", title: action === "approve" ? `${r.member.firstName} can sign in on the new phone` : "Request denied" });
      setDeny(null);
      setDenyNote("");
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't update request", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  async function unlock(d: DeviceDTO) {
    setBusy(d.id);
    try {
      const res = await fetch("/api/admin/mobile/devices", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId: d.member.id }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      toast({ tone: "success", title: "Device unlocked", description: `${d.member.firstName} will be signed out and can install the app on a new phone.` });
      setUnlocking(null);
      setDevices((prev) => prev.filter((x) => x.id !== d.id));
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't unlock device", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  React.useEffect(() => {
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/admin/mobile/devices?q=${encodeURIComponent(q)}`);
        const json = await res.json();
        if (json.ok) {
          setDevices(
            (json.devices as (Omit<DeviceDTO, "member"> & { member: { id: string; firstName: string; lastName: string; phone: string; email: string | null; location: { slug: string; name: string } } })[]).map((d) => ({
              ...d,
              member: { id: d.member.id, firstName: d.member.firstName, lastName: d.member.lastName, phone: d.member.phone, email: d.member.email, locationSlug: d.member.location.slug, locationName: d.member.location.name },
            })),
          );
        }
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="New phone requests" subtitle="A member signed in on a phone that isn't the one bound to their account. Approving moves their account to the new phone and signs out the old one." />
        <div className="mt-4 space-y-3">
          {pending.length === 0 && <EmptyState icon={<Smartphone size={20} />} title="No pending requests" description="Members who get a new phone will show up here when they try to sign in." />}
          {pending.map((r) => (
            <div key={r.id} id={`req-${r.id}`} className={["flex flex-col gap-3 rounded-apple border p-4 sm:flex-row sm:items-center", highlightRequestId === r.id ? "border-apple-blue bg-apple-blue/5" : "border-apple-border"].join(" ")}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={adminRoutes.loc.members.detail(r.member.locationSlug, r.member.id)} className="font-semibold text-apple-text hover:underline">
                    {r.member.firstName} {r.member.lastName}
                  </Link>
                  <span className="text-apple-sm text-apple-text-secondary">{fmtPhone(r.member.phone)}</span>
                  <Badge tone="muted" size="sm">{r.member.locationName}</Badge>
                </div>
                <p className="mt-1 text-apple-sm text-apple-text-secondary">
                  Wants to move to <span className="font-medium text-apple-text">{deviceLabel(r.toDeviceName, r.toDeviceModel, r.toPlatform)}</span>
                  {r.toDeviceModel && r.toDeviceName ? ` (${r.toDeviceModel})` : ""} · requested {fmt(r.createdAt)}
                </p>
                {r.memberNote && <p className="mt-1 text-apple-sm italic text-apple-text-secondary">“{r.memberNote}”</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="secondary" size="sm" iconLeft={<X size={14} />} disabled={busy === r.id} onClick={() => setDeny(r)}>
                  Deny
                </Button>
                <Button size="sm" iconLeft={<Check size={14} />} loading={busy === r.id} onClick={() => decide(r, "approve")}>
                  Approve transfer
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Bound devices"
          subtitle="Each member can use the app on one phone. Unlock a device when someone loses their phone or wants to start fresh — they'll be signed out and can sign in on any phone."
          action={<Input placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} prefix={<Search size={14} />} className="w-56" />}
        />
        <div className="mt-4 overflow-x-auto">
          {devices.length === 0 ? (
            <EmptyState icon={<Smartphone size={20} />} title={q ? "No devices match" : "No devices yet"} description={q ? "Try a different name or phone number." : "Devices appear once members sign in to the app."} />
          ) : (
            <table className="w-full text-left text-apple-sm">
              <thead className="text-apple-xs uppercase tracking-wide text-apple-text-tertiary">
                <tr>
                  <th className="pb-2 pr-4 font-medium">Member</th>
                  <th className="pb-2 pr-4 font-medium">Device</th>
                  <th className="pb-2 pr-4 font-medium">App</th>
                  <th className="pb-2 pr-4 font-medium">Push</th>
                  <th className="pb-2 pr-4 font-medium">Bound</th>
                  <th className="pb-2 pr-4 font-medium">Last seen</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody className={searching ? "opacity-60" : ""}>
                {devices.map((d) => (
                  <tr key={d.id} className="border-t border-apple-divider">
                    <td className="py-2.5 pr-4">
                      <Link href={adminRoutes.loc.members.detail(d.member.locationSlug, d.member.id)} className="font-medium text-apple-text hover:underline">
                        {d.member.firstName} {d.member.lastName}
                      </Link>
                      <div className="text-apple-xs text-apple-text-secondary">{fmtPhone(d.member.phone)} · {d.member.locationName}</div>
                    </td>
                    <td className="py-2.5 pr-4">
                      <div className="text-apple-text">{deviceLabel(d.name, d.model, d.platform)}</div>
                      <div className="text-apple-xs text-apple-text-secondary">
                        {d.platform === "android" ? "Android" : "iOS"}
                        {d.osVersion ? ` ${d.osVersion}` : ""}
                        {d.model && d.name ? ` · ${d.model}` : ""}
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-apple-text-secondary">{d.appVersion ?? "—"}</td>
                    <td className="py-2.5 pr-4">
                      {d.pushEnabled ? (
                        <Badge tone="success" size="sm">On</Badge>
                      ) : d.pushPermission === "denied" ? (
                        <Badge tone="warn" size="sm">Denied → SMS</Badge>
                      ) : (
                        <Badge tone="muted" size="sm">Off → SMS</Badge>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-apple-text-secondary">{fmt(d.boundAt)}</td>
                    <td className="py-2.5 pr-4 text-apple-text-secondary">{fmt(d.lastSeenAt)}</td>
                    <td className="py-2.5 text-right">
                      <Button variant="secondary" size="sm" iconLeft={<Unlock size={14} />} onClick={() => setUnlocking(d)}>
                        Unlock
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {recent.length > 0 && (
        <Card>
          <CardHeader title="Recent decisions" />
          <div className="mt-4 divide-y divide-apple-divider">
            {recent.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-apple-sm">
                <div className="min-w-0">
                  <span className="font-medium text-apple-text">
                    {r.member.firstName} {r.member.lastName}
                  </span>
                  <span className="text-apple-text-secondary"> → {deviceLabel(r.toDeviceName, r.toDeviceModel, r.toPlatform)}</span>
                  {r.resolutionNote && <div className="truncate text-apple-xs text-apple-text-secondary">{r.resolutionNote}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-2 text-apple-xs text-apple-text-secondary">
                  <StatusBadge status={r.status} size="sm" />
                  {fmt(r.resolvedAt ?? r.createdAt)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Modal
        open={!!deny}
        onClose={() => setDeny(null)}
        title="Deny new phone request"
        description={deny ? `${deny.member.firstName} will stay bound to their current phone and see your note in the app.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeny(null)}>Cancel</Button>
            <Button variant="danger" loading={busy === deny?.id} onClick={() => deny && decide(deny, "deny", denyNote.trim() || undefined)}>
              Deny request
            </Button>
          </>
        }
      >
        <Textarea label="Note to member (optional)" value={denyNote} onChange={(e) => setDenyNote(e.target.value)} placeholder="e.g. Please stop by the front desk with ID." rows={3} />
      </Modal>

      <Modal
        open={!!unlocking}
        onClose={() => setUnlocking(null)}
        title="Unlock device"
        description={unlocking ? `${unlocking.member.firstName} ${unlocking.member.lastName} will be signed out of ${deviceLabel(unlocking.name, unlocking.model, unlocking.platform)} and can sign in on any phone. Their account and bookings aren't affected.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setUnlocking(null)}>Cancel</Button>
            <Button loading={busy === unlocking?.id} iconLeft={<Unlock size={14} />} onClick={() => unlocking && unlock(unlocking)}>
              Unlock device
            </Button>
          </>
        }
      >
        <p className="text-apple-sm text-apple-text-secondary">Use this when a member lost their phone, replaced it, or the app is misbehaving on their device.</p>
      </Modal>
    </div>
  );
}
