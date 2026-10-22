"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, CreditCard } from "lucide-react";
import { Button, Input, Select, useToast } from "@/components/ui";
import { Field } from "@/components/admin/location-settings/SettingsSection";
import type { SquareStatus } from "@/app/api/admin/billing/_shared";

type SquareLocationOption = { id: string; name: string; businessName: string | null; status: string; currency: string | null };

async function api(method: "POST" | "PUT" | "DELETE", body: Record<string, unknown>) {
  const res = await fetch("/api/admin/billing/square", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Request failed");
  return json;
}

/**
 * Billing → Settings → Square. Each Tee24 location is connected to its own
 * Square account: paste that account's access token, pick the Square location
 * it should charge through, and (optionally) the application id + webhook key.
 */
export function SquareConnectForm({ slug, status, canEdit }: { slug: string; status: SquareStatus; canEdit: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState<"verify" | "save" | "disconnect" | null>(null);
  const [copied, setCopied] = React.useState(false);

  const [env, setEnv] = React.useState<"production" | "sandbox">(status.env);
  const [accessToken, setAccessToken] = React.useState("");
  const [applicationId, setApplicationId] = React.useState(status.source === "location" ? status.applicationId ?? "" : "");
  const [squareLocationId, setSquareLocationId] = React.useState(status.source === "location" ? status.squareLocationId ?? "" : "");
  const [webhookKey, setWebhookKey] = React.useState("");
  const [clearWebhookKey, setClearWebhookKey] = React.useState(false);
  const [options, setOptions] = React.useState<SquareLocationOption[] | null>(null);

  const hasStoredToken = status.source === "location" && Boolean(status.accessTokenHint);

  function reset() {
    setEnv(status.env);
    setAccessToken("");
    setApplicationId(status.source === "location" ? status.applicationId ?? "" : "");
    setSquareLocationId(status.source === "location" ? status.squareLocationId ?? "" : "");
    setWebhookKey("");
    setClearWebhookKey(false);
    setOptions(null);
  }

  async function verify() {
    setBusy("verify");
    try {
      const r = await api("POST", { locationSlug: slug, action: "verify", env, accessToken: accessToken || null });
      const locs = r.locations as SquareLocationOption[];
      setOptions(locs);
      if (!locs.some((l) => l.id === squareLocationId)) setSquareLocationId(locs.length === 1 ? locs[0].id : "");
      toast({ tone: "success", title: "Token works", description: `${locs.length} Square location${locs.length === 1 ? "" : "s"} found${locs[0]?.businessName ? ` for ${locs[0].businessName}` : ""}.` });
    } catch (e) {
      setOptions(null);
      toast({ tone: "error", title: "Could not verify token", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    try {
      const r = await api("PUT", { locationSlug: slug, env, accessToken: accessToken || null, applicationId, squareLocationId, webhookSignatureKey: webhookKey || null, clearWebhookKey });
      toast({ tone: "success", title: "Square connected", description: r.merchantName ? `Charging through ${r.merchantName}.` : undefined });
      setEditing(false);
      setAccessToken("");
      setWebhookKey("");
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Could not save", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect Square from this location? Cards on file stay recorded but nothing can be charged until it is reconnected.")) return;
    setBusy("disconnect");
    try {
      await api("DELETE", { locationSlug: slug });
      toast({ tone: "success", title: "Square disconnected" });
      setEditing(false);
      reset();
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Could not disconnect", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  function copyWebhookUrl() {
    navigator.clipboard?.writeText(status.webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const tone = status.configured ? (status.missing.length ? "warn" : "ok") : "off";
  const headerClass = tone === "ok" ? "border-apple-green/30 bg-apple-green/5" : tone === "warn" ? "border-apple-orange/40 bg-apple-orange/5" : "border-apple-orange/40 bg-apple-orange/5";

  return (
    <section className="rounded-apple border border-apple-divider bg-white p-4 shadow-apple sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-apple-lg font-semibold text-apple-text">Square account</h2>
          <p className="mt-0.5 text-apple-sm text-apple-text-secondary">
            Each location uses its own Square business. Cards on file, recurring charges, signup payments, POS card entry and refunds for this location all go through the account connected here.
          </p>
        </div>
        {canEdit && !editing && (
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            {status.source === "location" ? "Edit" : "Connect"}
          </Button>
        )}
      </div>

      {!editing && (
        <div className="space-y-4">
          <div className={`flex items-start gap-3 rounded-apple border p-3 ${headerClass}`}>
            <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone === "ok" ? "bg-apple-green/15 text-apple-green" : "bg-apple-orange/15 text-apple-orange"}`}>
              {tone === "ok" ? <Check className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />}
            </div>
            <div className="min-w-0 text-apple-sm">
              <div className="font-semibold text-apple-text">
                {!status.configured
                  ? "Not connected"
                  : status.source === "env"
                    ? `Using the shared SQUARE_* environment fallback (${status.env})`
                    : `Connected${status.merchantName ? ` to ${status.merchantName}` : ""} (${status.env})`}
              </div>
              {status.missing.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-apple-text-secondary">
                  {status.missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
              {status.source === "env" && (
                <p className="mt-1 text-apple-text-secondary">Connect this location&apos;s own account to stop sharing one Square business across locations.</p>
              )}
            </div>
          </div>

          {status.configured && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Square location" value={status.squareLocationId} mono />
              <Field label="Access token" value={status.accessTokenHint} mono />
              <Field label="Application ID" value={status.applicationId} mono />
              <Field label="Webhook signature key" value={status.webhookSignatureKeySet ? "Set" : "Not set"} />
              {status.connectedAt && <Field label="Connected" value={new Date(status.connectedAt).toLocaleString()} />}
            </div>
          )}

          <div>
            <div className="text-apple-xs font-medium text-apple-text-tertiary">Webhook notification URL (Square Developer Dashboard → Webhooks, one subscription per Square account)</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <code className="break-all rounded bg-apple-fill-secondary px-2 py-1 font-mono text-apple-xs text-apple-text">{status.webhookUrl}</code>
              <Button size="sm" variant="secondary" iconLeft={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} onClick={copyWebhookUrl}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="mt-1 text-apple-xs text-apple-text-tertiary">Subscribe to: payment.updated, refund.updated, card.updated, card.disabled, card.forgotten, dispute.created. Paste that subscription&apos;s signature key below.</p>
          </div>
        </div>
      )}

      {editing && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Environment" value={env} onChange={(e) => { setEnv(e.target.value as "production" | "sandbox"); setOptions(null); }}>
              <option value="production">Production</option>
              <option value="sandbox">Sandbox (testing)</option>
            </Select>
            <Input
              label="Application ID"
              value={applicationId}
              onChange={(e) => setApplicationId(e.target.value)}
              placeholder="sq0idp-…"
              hint="Developer Dashboard → your app → Credentials. Needed for card entry in signup, portal and POS."
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Input
                label={hasStoredToken ? `Access token (stored ${status.accessTokenHint} — paste a new one to rotate)` : "Access token"}
                type="password"
                value={accessToken}
                onChange={(e) => { setAccessToken(e.target.value); setOptions(null); }}
                placeholder={hasStoredToken ? "Leave blank to keep the current token" : "EAAA…"}
                hint="Developer Dashboard → your app → Credentials → Production access token. Stored encrypted; never shown again."
                autoComplete="new-password"
              />
            </div>
            <Button variant="secondary" onClick={verify} loading={busy === "verify"} disabled={busy !== null || (!accessToken && !hasStoredToken)}>
              Verify &amp; load locations
            </Button>
          </div>

          {options ? (
            <Select label="Square location to charge through" value={squareLocationId} onChange={(e) => setSquareLocationId(e.target.value)} hint="Payments, refunds and the receipts members see are attributed to this Square location.">
              <option value="">Choose…</option>
              {options.map((l) => (
                <option key={l.id} value={l.id} disabled={l.status !== "ACTIVE"}>
                  {l.name}
                  {l.businessName && l.businessName !== l.name ? ` — ${l.businessName}` : ""}
                  {l.currency ? ` (${l.currency})` : ""}
                  {l.status !== "ACTIVE" ? ` · ${l.status.toLowerCase()}` : ""}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              label="Square location ID"
              value={squareLocationId}
              onChange={(e) => setSquareLocationId(e.target.value)}
              placeholder="L…"
              hint="Click “Verify & load locations” to pick from the account, or paste the id from Square → Account & Settings → Business → Locations."
              autoComplete="off"
            />
          )}

          <div>
            <Input
              label={status.webhookSignatureKeySet && status.source === "location" ? "Webhook signature key (set — paste a new one to replace)" : "Webhook signature key"}
              type="password"
              value={webhookKey}
              onChange={(e) => { setWebhookKey(e.target.value); setClearWebhookKey(false); }}
              placeholder={status.webhookSignatureKeySet ? "Leave blank to keep the current key" : "From the webhook subscription in Square"}
              hint="Lets Square tell us about refunds, disputes and expired cards. Each Square account has its own subscription and key."
              autoComplete="new-password"
            />
            {status.webhookSignatureKeySet && status.source === "location" && (
              <label className="mt-2 flex items-center gap-2 text-apple-xs text-apple-text-secondary">
                <input type="checkbox" checked={clearWebhookKey} onChange={(e) => { setClearWebhookKey(e.target.checked); if (e.target.checked) setWebhookKey(""); }} />
                Remove the stored webhook key
              </label>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-apple-divider pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              {status.source === "location" && (
                <Button variant="danger" size="sm" onClick={disconnect} loading={busy === "disconnect"} disabled={busy !== null && busy !== "disconnect"}>
                  Disconnect Square
                </Button>
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="secondary" onClick={() => { setEditing(false); reset(); }} disabled={busy !== null}>
                Cancel
              </Button>
              <Button onClick={save} loading={busy === "save"} disabled={busy !== null || !squareLocationId || (!accessToken && !hasStoredToken)}>
                {hasStoredToken ? "Save changes" : "Connect Square"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
