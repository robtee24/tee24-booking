"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button, Card, CardHeader, Input, PageHeader, Textarea, useToast } from "@/components/ui";
import { Toggle } from "@/components/admin/location-settings/SettingsSection";
import { adminRoutes } from "@/lib/admin/routes";

const MERGE_HINT = "Use {firstName}, {lastName}, {email}, {phone}, {today} to insert member details when signing.";

export default function EditDocumentPage() {
  const params = useParams<{ slug: string; id: string }>();
  const slug = decodeURIComponent(params?.slug ?? "");
  const id = decodeURIComponent(params?.id ?? "");
  const router = useRouter();
  const { toast } = useToast();

  const [form, setForm] = React.useState({
    name: "",
    description: "",
    body: "",
    format: "html" as "text" | "html",
    requiredAtSignup: false,
    expiresAfterDays: "",
    graceAfterExpiryDays: "7",
    active: true,
  });
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    fetch(`/api/admin/documents/${id}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || `Failed (${r.status})`);
        const d = j.document as { name: string; description: string | null; bodyHtml: string | null; requiredAtSignup: boolean; expiresAfterDays: number | null; graceAfterExpiryDays: number | null; active: boolean };
        setForm({
          name: d.name,
          description: d.description ?? "",
          body: d.bodyHtml ?? "",
          format: "html",
          requiredAtSignup: d.requiredAtSignup,
          expiresAfterDays: d.expiresAfterDays != null ? String(d.expiresAfterDays) : "",
          graceAfterExpiryDays: d.graceAfterExpiryDays != null ? String(d.graceAfterExpiryDays) : "7",
          active: d.active,
        });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load document"))
      .finally(() => setLoading(false));
  }, [id]);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const isHtml = /\.html?$/i.test(file.name) || file.type === "text/html";
    if (!isHtml && !/\.(txt|md)$/i.test(file.name) && !file.type.startsWith("text/")) {
      setError("Upload a .txt, .md, or .html file. For Word documents, save as HTML or paste the text below.");
      return;
    }
    const text = await file.text();
    setForm((f) => ({ ...f, body: text, format: isHtml ? "html" : "text" }));
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          body: form.body,
          format: form.format,
          requiredAtSignup: form.requiredAtSignup,
          expiresAfterDays: form.expiresAfterDays,
          graceAfterExpiryDays: form.graceAfterExpiryDays,
          active: form.active,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Failed (${res.status})`);
      toast({ tone: "success", title: "Document saved", description: form.name });
      router.push(adminRoutes.loc.members.documents(slug));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save document");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-apple-sm text-apple-text-secondary">Loading document…</p>;

  return (
    <div className="space-y-6">
      <PageHeader title="Edit document" description="Changes to the body bump the version. Existing signatures stay on the version they signed." />

      <form onSubmit={onSubmit} className="space-y-6">
        <Card>
          <CardHeader title="Basics" />
          <div className="mt-4 grid grid-cols-1 gap-4">
            <Input label="Document name" required value={form.name} onChange={(e) => set("name", e.target.value)} />
            <Textarea label="Description (optional)" rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
            <Toggle checked={form.active} onChange={(v) => set("active", v)} label="Active" hint="Retired documents stay on file but aren't assigned to new members." />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Content"
            subtitle={MERGE_HINT}
            action={
              <>
                <input ref={fileRef} type="file" accept=".txt,.md,.html,.htm,text/plain,text/html" className="hidden" onChange={onFile} />
                <Button type="button" variant="secondary" size="sm" iconLeft={<Upload className="h-3.5 w-3.5" />} onClick={() => fileRef.current?.click()}>
                  Import file
                </Button>
              </>
            }
          />
          <div className="mt-4 space-y-3">
            <Textarea rows={14} required className="font-mono text-apple-xs" value={form.body} onChange={(e) => set("body", e.target.value)} />
            <label className="flex items-center gap-2 text-apple-xs text-apple-text-secondary">
              <input type="checkbox" className="h-3.5 w-3.5 accent-apple-blue" checked={form.format === "html"} onChange={(e) => set("format", e.target.checked ? "html" : "text")} />
              Content is HTML
            </label>
          </div>
        </Card>

        <Card>
          <CardHeader title="Rules" />
          <div className="mt-4 space-y-5">
            <Toggle checked={form.requiredAtSignup} onChange={(v) => set("requiredAtSignup", v)} label="Required at signup" hint="New members must sign before their access is enabled." />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Expires after (days)" type="number" inputMode="numeric" min={1} value={form.expiresAfterDays} onChange={(e) => set("expiresAfterDays", e.target.value)} hint="Leave blank if a signature never expires." />
              <Input label="Grace period after expiry (days)" type="number" inputMode="numeric" min={0} value={form.graceAfterExpiryDays} onChange={(e) => set("graceAfterExpiryDays", e.target.value)} />
            </div>
          </div>
        </Card>

        {error && <p className="text-apple-sm text-apple-red">{error}</p>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" type="button" onClick={() => router.push(adminRoutes.loc.members.documents(slug))}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Save document
          </Button>
        </div>
      </form>
    </div>
  );
}
