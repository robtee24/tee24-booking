"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardHeader, Input, Select, useToast } from "@/components/ui";
import { adminRoutes } from "@/lib/admin/routes";
import { PermissionMatrix, grantsToSet, setToGrants, type Grant, type LocationLite, type PermissionGroup, type Preset } from "./PermissionMatrix";

export type AdminRole = "ROOT" | "FULL" | "SCOPED";

export type StaffAdminDTO = {
  id: string;
  phone: string;
  email: string | null;
  name: string | null;
  role: AdminRole;
  twoFactorEnabled: boolean;
  inviteStatus: string;
  invitedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  locations: { locationId: string; location: LocationLite }[];
  permissions: Grant[];
};

export type Catalog = { groups: PermissionGroup[]; presets: Record<string, Preset> };

export function AdminForm({
  mode,
  admin,
  catalog,
  locations,
  actorRole,
}: {
  mode: "create" | "edit";
  admin?: StaffAdminDTO;
  catalog: Catalog;
  locations: LocationLite[];
  actorRole: AdminRole;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [name, setName] = React.useState(admin?.name ?? "");
  const [email, setEmail] = React.useState(admin?.email ?? "");
  const [phone, setPhone] = React.useState(admin?.phone ?? "");
  const [role, setRole] = React.useState<AdminRole>(admin?.role ?? "SCOPED");
  const [locIds, setLocIds] = React.useState<string[]>(admin?.locations.map((l) => l.locationId) ?? []);
  const [grants, setGrants] = React.useState<Set<string>>(grantsToSet(admin?.permissions ?? []));
  const [sendInvite, setSendInvite] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const canSetOrgRoles = actorRole === "ROOT";
  const assignedLocations = React.useMemo(() => locations.filter((l) => locIds.includes(l.id)), [locations, locIds]);

  function toggleLoc(id: string) {
    setLocIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!phone.trim()) return setErr("Phone is required.");
    if (role === "SCOPED" && locIds.length === 0) return setErr("Assign at least one location to a scoped admin.");
    setSaving(true);
    try {
      const payload = {
        name: name.trim() || null,
        email: email.trim() || null,
        phone: phone.trim(),
        role,
        locationIds: role === "SCOPED" ? locIds : [],
        permissions: role === "SCOPED" ? setToGrants(grants).filter((g) => !g.locationId || locIds.includes(g.locationId)) : [],
        ...(mode === "create" ? { sendInvite } : {}),
      };
      const res = await fetch(mode === "create" ? "/api/admin/admins" : `/api/admin/admins/${encodeURIComponent(admin!.id)}`, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      toast({ tone: "success", title: mode === "create" ? "Admin created" : "Admin saved" });
      if (mode === "create") router.push(adminRoutes.adminDetail(json.admin.id));
      router.refresh();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Card>
        <CardHeader title="Profile" subtitle="Phone is the login credential — a one-time code is texted to it." />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@tee24.golf" hint="Optional — used for the invite email and notifications." />
          <Input label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 (336) 555-0100" required className="font-mono" />
          <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as AdminRole)} hint="ROOT and FULL access every location with every permission.">
            <option value="SCOPED">Scoped — specific locations & permissions</option>
            <option value="FULL" disabled={!canSetOrgRoles}>Full — all locations</option>
            <option value="ROOT" disabled={!canSetOrgRoles}>Root — all locations + manage admins</option>
          </Select>
        </div>
      </Card>

      {role === "SCOPED" && (
        <>
          <Card>
            <CardHeader title="Assigned locations" subtitle="Scoped admins only see the locations ticked here." />
            <div className="mt-4 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {locations.map((l) => (
                <label key={l.id} className="flex cursor-pointer items-center gap-2.5 rounded-apple-sm px-2 py-2 transition-colors hover:bg-apple-fill-secondary">
                  <input type="checkbox" className="h-4 w-4 accent-apple-blue" checked={locIds.includes(l.id)} onChange={() => toggleLoc(l.id)} />
                  <span className="text-apple-sm text-apple-text">{l.name}</span>
                  <span className="rounded-apple-pill bg-apple-fill-secondary px-2 py-0.5 font-mono text-[10px] text-apple-text-tertiary">{l.slug}</span>
                </label>
              ))}
              {locations.length === 0 && <p className="text-apple-sm text-apple-text-tertiary">No locations yet.</p>}
            </div>
          </Card>

          <Card>
            <CardHeader title="Permissions" subtitle="Tick what this person can do. Start from a preset and adjust." />
            <div className="mt-4">
              <PermissionMatrix groups={catalog.groups} presets={catalog.presets} locations={assignedLocations} value={grants} onChange={setGrants} />
            </div>
          </Card>
        </>
      )}

      {mode === "create" && (
        <Card>
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-apple-blue" checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} />
            <span>
              <span className="block text-apple-sm font-medium text-apple-text">Send invite now</span>
              <span className="block text-apple-xs text-apple-text-tertiary">Texts the login link to their phone (and emails it if an address is set). You can resend later.</span>
            </span>
          </label>
        </Card>
      )}

      {err && <div className="rounded-apple-sm border border-apple-red/30 bg-apple-red/5 px-4 py-2.5 text-apple-sm text-apple-red">{err}</div>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={() => router.push(adminRoutes.admins())} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {mode === "create" ? (sendInvite ? "Create & send invite" : "Create admin") : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
