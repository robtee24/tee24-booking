"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { Badge, Button, Card, CardHeader, Input, Modal, Select, useToast } from "@/components/ui";

export type MeDTO = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string;
  role: "ROOT" | "FULL" | "SCOPED";
  twoFactorEnabled: boolean;
  hasPin: boolean;
  lastLoginAt: string | null;
};

/** localStorage key read by the location dashboard's tasks widget. */
export const TASKS_WINDOW_KEY = "tee24-admin:dashboard-tasks-window";
export const TASKS_WINDOW_OPTIONS = [
  { value: "today", label: "Due today" },
  { value: "7d", label: "Due in the next 7 days" },
  { value: "30d", label: "Due in the next 30 days" },
  { value: "all", label: "All open tasks" },
] as const;
export type TasksWindow = (typeof TASKS_WINDOW_OPTIONS)[number]["value"];

export function readTasksWindow(): TasksWindow {
  if (typeof window === "undefined") return "7d";
  const v = window.localStorage.getItem(TASKS_WINDOW_KEY);
  return (TASKS_WINDOW_OPTIONS.some((o) => o.value === v) ? v : "7d") as TasksWindow;
}

export function MyAccountCard({ me }: { me: MeDTO }) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = React.useState(me.name ?? "");
  const [email, setEmail] = React.useState(me.email ?? "");
  const [saving, setSaving] = React.useState(false);
  const [tasksWindow, setTasksWindow] = React.useState<TasksWindow>("7d");

  React.useEffect(() => setTasksWindow(readTasksWindow()), []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/admin/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || null, email: email.trim() || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      toast({ tone: "success", title: "Profile saved" });
      router.refresh();
    } catch (err: unknown) {
      toast({ tone: "error", title: "Couldn't save", description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="My account"
        subtitle={`Signed in as ${me.phone} · ${me.role === "ROOT" ? "Root admin" : me.role === "FULL" ? "Full access" : "Location admin"}`}
        action={me.lastLoginAt ? <span className="text-apple-xs text-apple-text-tertiary">Last login {new Date(me.lastLoginAt).toLocaleString()}</span> : undefined}
      />

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <form onSubmit={saveProfile} className="space-y-3">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@tee24.golf" hint="Used for staff notifications and invites." />
          <div className="flex justify-end">
            <Button type="submit" size="sm" loading={saving}>Save profile</Button>
          </div>
        </form>

        <div className="space-y-4">
          <TwoFactorSection enabled={me.twoFactorEnabled} />
          <PinSection hasPin={me.hasPin} />
          <div>
            <Select
              label="Dashboard tasks window"
              value={tasksWindow}
              onChange={(e) => {
                const v = e.target.value as TasksWindow;
                setTasksWindow(v);
                window.localStorage.setItem(TASKS_WINDOW_KEY, v);
                toast({ tone: "success", title: "Preference saved on this device" });
              }}
              hint="Which open tasks the location dashboard shows you. Stored in this browser only."
            >
              {TASKS_WINDOW_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ─────────────────────────── 2FA ─────────────────────────────────────────── */

function TwoFactorSection({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = React.useState<"setup" | "disable" | null>(null);
  const [secret, setSecret] = React.useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = React.useState<string | null>(null);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function beginSetup() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/auth/2fa/setup", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setSecret(json.secret);
      setOtpauthUrl(json.otpauthUrl);
      setCode("");
      setOpen("setup");
    } catch (err: unknown) {
      toast({ tone: "error", title: "Couldn't start 2FA setup", description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const path = open === "setup" ? "/api/admin/auth/2fa/verify" : "/api/admin/auth/2fa/disable";
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      toast({ tone: "success", title: open === "setup" ? "Two-factor enabled" : "Two-factor disabled" });
      setOpen(null);
      router.refresh();
    } catch (err: unknown) {
      toast({ tone: "error", title: "Invalid code", description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-apple-sm border border-apple-border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-apple-sm font-medium text-apple-text">
            Two-factor authentication
            {enabled ? <Badge tone="success" size="sm">On</Badge> : <Badge tone="muted" size="sm">Off</Badge>}
          </div>
          <p className="mt-0.5 text-apple-xs text-apple-text-tertiary">
            {enabled ? "Login requires your authenticator app after the SMS code." : "Add an authenticator app step after the SMS code."}
          </p>
        </div>
        {enabled ? (
          <Button size="sm" variant="secondary" iconLeft={<ShieldOff className="h-3.5 w-3.5" />} onClick={() => { setCode(""); setOpen("disable"); }}>
            Disable
          </Button>
        ) : (
          <Button size="sm" iconLeft={<ShieldCheck className="h-3.5 w-3.5" />} loading={busy && !open} onClick={() => void beginSetup()}>
            Enable
          </Button>
        )}
      </div>

      <Modal
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open === "setup" ? "Set up two-factor authentication" : "Disable two-factor authentication"}
        description={open === "setup" ? "Scan the QR code with Google Authenticator, 1Password, or Authy, then enter the 6-digit code." : "Enter a current code from your authenticator app to confirm."}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setOpen(null)}>Cancel</Button>
            <Button form="twofa-confirm" type="submit" loading={busy} variant={open === "disable" ? "danger" : "primary"}>
              {open === "setup" ? "Verify & enable" : "Disable 2FA"}
            </Button>
          </div>
        }
      >
        <form id="twofa-confirm" onSubmit={confirm} className="space-y-4">
          {open === "setup" && otpauthUrl && (
            <div className="flex flex-col items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="2FA QR code"
                width={180}
                height={180}
                className="rounded-apple-sm border border-apple-border bg-white p-2"
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(otpauthUrl)}`}
              />
              <div className="text-center text-apple-xs text-apple-text-tertiary">
                Can't scan? Enter this key manually:
                <code className="mt-1 block break-all rounded bg-apple-fill-secondary px-2 py-1 font-mono text-apple-text">{secret}</code>
              </div>
            </div>
          )}
          <Input label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} className="text-center font-mono text-xl tracking-widest" autoFocus required />
        </form>
      </Modal>
    </div>
  );
}

/* ─────────────────────────── PIN ─────────────────────────────────────────── */

function PinSection({ hasPin }: { hasPin: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [pin, setPin] = React.useState("");
  const [confirmPin, setConfirmPin] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4,6}$/.test(pin)) return toast({ tone: "error", title: "PIN must be 4–6 digits" });
    if (pin !== confirmPin) return toast({ tone: "error", title: "PINs don't match" });
    setBusy(true);
    try {
      const res = await fetch("/api/admin/auth/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      toast({ tone: "success", title: "Front-desk PIN saved" });
      setOpen(false);
      setPin("");
      setConfirmPin("");
      router.refresh();
    } catch (err: unknown) {
      toast({ tone: "error", title: "Couldn't save PIN", description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/auth/pin", { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ tone: "success", title: "PIN removed" });
      router.refresh();
    } catch (err: unknown) {
      toast({ tone: "error", title: "Couldn't remove PIN", description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-apple-sm border border-apple-border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-apple-sm font-medium text-apple-text">
            Front-desk PIN
            {hasPin ? <Badge tone="success" size="sm">Set</Badge> : <Badge tone="muted" size="sm">None</Badge>}
          </div>
          <p className="mt-0.5 text-apple-xs text-apple-text-tertiary">4–6 digits to re-verify yourself on a shared front-desk computer.</p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" iconLeft={<KeyRound className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
            {hasPin ? "Change" : "Set PIN"}
          </Button>
          {hasPin && (
            <Button size="sm" variant="ghost" loading={busy && !open} onClick={() => void remove()}>Remove</Button>
          )}
        </div>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={hasPin ? "Change front-desk PIN" : "Set front-desk PIN"}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button form="pin-form" type="submit" loading={busy}>Save PIN</Button>
          </div>
        }
      >
        <form id="pin-form" onSubmit={save} className="space-y-3">
          <Input label="New PIN" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} className="font-mono tracking-widest" autoFocus />
          <Input label="Confirm PIN" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 6))} className="font-mono tracking-widest" />
        </form>
      </Modal>
    </div>
  );
}
