"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardHeader, Input, Select, Textarea, useToast } from "@/components/ui";
import { Code2, Copy, ExternalLink, Save, Trash2 } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { useAdminLocation } from "@/components/admin/LocationContext";
import { SIGNUP_ALWAYS_REQUIRED, SIGNUP_FIELD_KEYS, SIGNUP_FIELD_LABELS, type SignupFieldConfig, type SignupFieldKey, type SignupFieldMode, type SignupThemeOverrides, slugify } from "@/lib/signup-form-config";
import { Field, MultiSelectChips, Toggle, useErrorToast, useMarketingApi } from "./shared";

export type SignupFormDraft = {
  id?: string;
  name: string;
  slug: string;
  description: string;
  active: boolean;
  allowedPlanIds: string[];
  defaultPlanId: string;
  requiredFields: SignupFieldConfig;
  customFieldIds: string[];
  requiredDocumentIds: string[];
  allowDiscountCode: boolean;
  autoApplyDiscountId: string;
  photoRequired: boolean;
  authSetup: "NONE" | "MAGIC_LINK" | "PASSWORD";
  themeOverrides: SignupThemeOverrides;
  confirmationUrl: string;
  collectTax: boolean;
  autoTagIds: string[];
  autoEnrollAutomationIds: string[];
  embedAllowed: boolean;
};

export type SignupBuilderOptions = {
  plans: { id: string; name: string; category?: string }[];
  customFields: { id: string; name: string }[];
  documents: { id: string; name: string }[];
  discounts: { id: string; name: string; code: string }[];
  tags: { id: string; name: string }[];
  automations: { id: string; name: string }[];
  publicUrl: string | null;
  embedSnippet: string | null;
  stats?: { signups30d: number; signupsTotal: number };
};

export function SignupFormBuilder({ initial, options }: { initial: SignupFormDraft; options: SignupBuilderOptions }) {
  const api = useMarketingApi();
  const onError = useErrorToast();
  const router = useRouter();
  const { toast } = useToast();
  const { slug: locSlug } = useAdminLocation();
  const [d, setD] = React.useState<SignupFormDraft>(initial);
  const [slugTouched, setSlugTouched] = React.useState(!!initial.id);
  const [saving, setSaving] = React.useState(false);
  const [showEmbed, setShowEmbed] = React.useState(false);
  const isNew = !d.id;

  function set<K extends keyof SignupFormDraft>(k: K, v: SignupFormDraft[K]) {
    setD((cur) => ({ ...cur, [k]: v }));
  }
  function setField(k: SignupFieldKey, mode: SignupFieldMode) {
    setD((cur) => ({ ...cur, requiredFields: { ...cur.requiredFields, [k]: mode } }));
  }

  async function save() {
    setSaving(true);
    try {
      const payload = { ...d, slug: d.slug || slugify(d.name), locationSlug: locSlug };
      if (isNew) {
        const res = await api<{ form: { id: string } }>("/api/admin/signup-forms", { method: "POST", json: payload });
        toast({ tone: "success", title: "Signup form created" });
        router.replace(adminRoutes.loc.marketing.signupFormDetail(locSlug, res.form.id));
      } else {
        await api(`/api/admin/signup-forms/${d.id}`, { method: "PATCH", json: payload });
        toast({ tone: "success", title: "Signup form saved" });
        router.refresh();
      }
    } catch (e) {
      onError(e, "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!d.id || !confirm(`Delete "${d.name}"? The public link will stop working.`)) return;
    try {
      await api(`/api/admin/signup-forms/${d.id}`, { method: "DELETE" });
      toast({ tone: "success", title: "Form deleted" });
      router.push(adminRoutes.loc.marketing.signupForms(locSlug));
    } catch (e) {
      onError(e);
    }
  }

  function copy(text: string, label: string) {
    navigator.clipboard?.writeText(text).then(() => toast({ tone: "success", title: `${label} copied` }));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader title="Basics" />
          <div className="mt-4 space-y-4">
            <Input label="Form name" value={d.name} onChange={(e) => { set("name", e.target.value); if (!slugTouched) set("slug", slugify(e.target.value)); }} placeholder="e.g. Founding member signup" />
            <Input label="URL slug" value={d.slug} onChange={(e) => { setSlugTouched(true); set("slug", slugify(e.target.value)); }} hint={`Public link: /signup/${d.slug || "…"}`} />
            <Textarea label="Description (internal)" rows={2} value={d.description} onChange={(e) => set("description", e.target.value)} />
            <div className="flex items-center justify-between rounded-apple border border-apple-border p-3">
              <div>
                <div className="text-apple-sm font-medium text-apple-text">Accepting signups</div>
                <div className="text-apple-xs text-apple-text-tertiary">Inactive forms show a “closed” message at the public URL.</div>
              </div>
              <Toggle checked={d.active} onChange={(v) => set("active", v)} />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Plans" subtitle="Which memberships can be chosen on this form" />
          <div className="mt-4 space-y-4">
            <Field label="Allowed plans" hint="Leave empty to show every active plan.">
              <MultiSelectChips options={options.plans.map((p) => ({ id: p.id, label: p.name }))} value={d.allowedPlanIds} onChange={(v) => set("allowedPlanIds", v)} empty="No plans yet." />
            </Field>
            <Select label="Pre-selected plan" value={d.defaultPlanId} onChange={(e) => set("defaultPlanId", e.target.value)}>
              <option value="">None</option>
              {options.plans.filter((p) => d.allowedPlanIds.length === 0 || d.allowedPlanIds.includes(p.id)).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-apple-sm"><input type="checkbox" checked={d.allowDiscountCode} onChange={(e) => set("allowDiscountCode", e.target.checked)} /> Allow discount codes</label>
              <label className="flex items-center gap-2 text-apple-sm"><input type="checkbox" checked={d.collectTax} onChange={(e) => set("collectTax", e.target.checked)} /> Collect sales tax</label>
            </div>
            <Select label="Auto-apply discount" value={d.autoApplyDiscountId} onChange={(e) => set("autoApplyDiscountId", e.target.value)}>
              <option value="">None</option>
              {options.discounts.map((x) => (
                <option key={x.id} value={x.id}>{x.name} ({x.code})</option>
              ))}
            </Select>
          </div>
        </Card>

        <Card>
          <CardHeader title="Fields" subtitle="What to collect. Name and email are always required." />
          <div className="mt-4 divide-y divide-apple-divider">
            {SIGNUP_FIELD_KEYS.map((k) => {
              const locked = SIGNUP_ALWAYS_REQUIRED.includes(k);
              const mode = k === "photo" && d.photoRequired ? "required" : d.requiredFields[k];
              return (
                <div key={k} className="flex items-center justify-between py-2 text-apple-sm">
                  <span className="text-apple-text">{SIGNUP_FIELD_LABELS[k]}</span>
                  <div className="flex rounded-apple-sm border border-apple-border p-0.5">
                    {(["hidden", "optional", "required"] as SignupFieldMode[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        disabled={locked}
                        onClick={() => {
                          setField(k, m);
                          if (k === "photo") set("photoRequired", m === "required");
                        }}
                        className={`rounded px-2 py-0.5 text-apple-xs capitalize ${mode === m ? "bg-apple-fill-secondary font-medium text-apple-text" : "text-apple-text-tertiary"} ${locked ? "cursor-not-allowed opacity-60" : ""}`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 space-y-4">
            <Field label="Custom fields">
              <MultiSelectChips options={options.customFields.map((c) => ({ id: c.id, label: c.name }))} value={d.customFieldIds} onChange={(v) => set("customFieldIds", v)} empty="No custom fields defined." />
            </Field>
            <Field label="Documents to sign at signup">
              <MultiSelectChips options={options.documents.map((c) => ({ id: c.id, label: c.name }))} value={d.requiredDocumentIds} onChange={(v) => set("requiredDocumentIds", v)} empty="No documents yet." />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="After signup" />
          <div className="mt-4 space-y-4">
            <Select label="Account setup" value={d.authSetup} onChange={(e) => set("authSetup", e.target.value as SignupFormDraft["authSetup"])}>
              <option value="MAGIC_LINK">Email a magic link (recommended)</option>
              <option value="PASSWORD">Choose a password on the form</option>
              <option value="NONE">No portal account</option>
            </Select>
            <Field label="Auto-apply tags">
              <MultiSelectChips options={options.tags.map((t) => ({ id: t.id, label: t.name }))} value={d.autoTagIds} onChange={(v) => set("autoTagIds", v)} empty="No tags yet." />
            </Field>
            <Field label="Enroll in automations">
              <MultiSelectChips options={options.automations.map((a) => ({ id: a.id, label: a.name }))} value={d.autoEnrollAutomationIds} onChange={(v) => set("autoEnrollAutomationIds", v)} empty="No automations yet." />
            </Field>
            <Input label="Confirmation redirect URL" value={d.confirmationUrl} onChange={(e) => set("confirmationUrl", e.target.value)} placeholder="https://yoursite.com/welcome (blank = built-in thank-you page)" />
          </div>
        </Card>

        <Card>
          <CardHeader title="Appearance" subtitle="Light overrides within the brand theme" />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Input label="Headline" value={d.themeOverrides.headline ?? ""} onChange={(e) => set("themeOverrides", { ...d.themeOverrides, headline: e.target.value || undefined })} />
            <Input label="Button label" value={d.themeOverrides.buttonLabel ?? ""} onChange={(e) => set("themeOverrides", { ...d.themeOverrides, buttonLabel: e.target.value || undefined })} placeholder="Join now" />
            <Input label="Brand color" type="text" value={d.themeOverrides.brandColor ?? ""} onChange={(e) => set("themeOverrides", { ...d.themeOverrides, brandColor: e.target.value || undefined })} placeholder="#0a7d3a" />
            <Input label="Logo URL" value={d.themeOverrides.logoUrl ?? ""} onChange={(e) => set("themeOverrides", { ...d.themeOverrides, logoUrl: e.target.value || undefined })} />
            <div className="sm:col-span-2">
              <Textarea label="Intro text" rows={2} value={d.themeOverrides.intro ?? ""} onChange={(e) => set("themeOverrides", { ...d.themeOverrides, intro: e.target.value || undefined })} />
            </div>
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <div className="flex flex-col gap-2">
            <Button iconLeft={<Save className="h-4 w-4" />} onClick={save} loading={saving} disabled={!d.name.trim()}>{isNew ? "Create form" : "Save changes"}</Button>
            {!isNew && <Button variant="ghost" iconLeft={<Trash2 className="h-4 w-4" />} onClick={remove}><span className="text-apple-red">Delete form</span></Button>}
          </div>
        </Card>

        {!isNew && options.publicUrl && (
          <Card>
            <CardHeader title="Share" />
            <div className="mt-3 space-y-3">
              <div className="rounded-apple-sm bg-apple-fill-secondary p-2 font-mono text-apple-xs break-all">{options.publicUrl}</div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" iconLeft={<Copy className="h-4 w-4" />} onClick={() => copy(options.publicUrl!, "Link")}>Copy link</Button>
                <a href={options.publicUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost" iconLeft={<ExternalLink className="h-4 w-4" />}>Preview</Button></a>
              </div>
              <div className="flex items-center justify-between border-t border-apple-divider pt-3">
                <div>
                  <div className="text-apple-sm font-medium text-apple-text">Allow embedding</div>
                  <div className="text-apple-xs text-apple-text-tertiary">Iframe the form on your website.</div>
                </div>
                <Toggle size="sm" checked={d.embedAllowed} onChange={(v) => set("embedAllowed", v)} />
              </div>
              {d.embedAllowed && options.embedSnippet && (
                <div>
                  <Button size="sm" variant="secondary" iconLeft={<Code2 className="h-4 w-4" />} onClick={() => setShowEmbed((s) => !s)}>{showEmbed ? "Hide" : "Show"} embed code</Button>
                  {showEmbed && (
                    <div className="mt-2">
                      <pre className="overflow-x-auto rounded-apple-sm bg-apple-fill-secondary p-2 text-[11px]">{options.embedSnippet}</pre>
                      <Button size="sm" variant="ghost" className="mt-1" iconLeft={<Copy className="h-4 w-4" />} onClick={() => copy(options.embedSnippet!, "Embed code")}>Copy embed code</Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>
        )}

        {!isNew && options.stats && (
          <Card>
            <CardHeader title="Performance" />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <div className="text-apple-2xl font-semibold text-apple-text">{options.stats.signups30d}</div>
                <div className="text-apple-xs text-apple-text-tertiary">Signups (30d)</div>
              </div>
              <div>
                <div className="text-apple-2xl font-semibold text-apple-text">{options.stats.signupsTotal}</div>
                <div className="text-apple-xs text-apple-text-tertiary">All time</div>
              </div>
            </div>
            <p className="mt-3 text-apple-xs text-apple-text-tertiary">Attributed from members whose source is <code>form:{d.slug}</code>.</p>
          </Card>
        )}

        <Card>
          <CardHeader title="Summary" />
          <ul className="mt-3 space-y-1 text-apple-xs text-apple-text-secondary">
            <li>{d.allowedPlanIds.length === 0 ? "All active plans" : `${d.allowedPlanIds.length} plan${d.allowedPlanIds.length === 1 ? "" : "s"}`} offered</li>
            <li>{SIGNUP_FIELD_KEYS.filter((k) => d.requiredFields[k] === "required").length} required · {SIGNUP_FIELD_KEYS.filter((k) => d.requiredFields[k] === "optional").length} optional fields</li>
            <li>{d.requiredDocumentIds.length} document{d.requiredDocumentIds.length === 1 ? "" : "s"} to sign</li>
            <li>{d.autoEnrollAutomationIds.length} automation{d.autoEnrollAutomationIds.length === 1 ? "" : "s"} on join</li>
            <li>Account: {d.authSetup === "MAGIC_LINK" ? "magic link" : d.authSetup === "PASSWORD" ? "password" : "none"}</li>
          </ul>
          <div className="mt-3 flex flex-wrap gap-1">
            <Badge tone={d.active ? "success" : "muted"} size="sm">{d.active ? "Active" : "Inactive"}</Badge>
            {d.embedAllowed && <Badge tone="info" size="sm">Embeddable</Badge>}
          </div>
          <Link href={adminRoutes.loc.marketing.signupForms(locSlug)} className="mt-3 inline-block text-apple-xs text-apple-blue hover:underline">← All forms</Link>
        </Card>
      </div>
    </div>
  );
}
