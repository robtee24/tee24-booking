"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button, Card, CardHeader, Input, PageHeader, Textarea, useToast } from "@/components/ui";
import { Toggle } from "@/components/admin/location-settings/SettingsSection";
import { adminRoutes } from "@/lib/admin/routes";

const MERGE_HINT = "Use {firstName}, {lastName}, {email}, {phone}, {today} to insert member details when signing.";

export default function NewDocumentPage() {
  const params = useParams<{ slug: string }>();
  const slug = decodeURIComponent(params?.slug ?? "");
  const router = useRouter();
  const { toast } = useToast();

  const [form, setForm] = React.useState({
    name: "",
    description: "",
    body: "",
    format: "text" as "text" | "html",
    requiredAtSignup: true,
    expiresAfterDays: "",
    graceAfterExpiryDays: "7",
  });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

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
    setForm((f) => ({ ...f, body: text, format: isHtml ? "html" : "text", name: f.name || file.name.replace(/\.[^.]+$/, "") }));
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationSlug: slug, ...form }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Failed (${res.status})`);
      toast({ tone: "success", title: "Document created", description: form.name });
      router.push(adminRoutes.loc.members.documents(slug));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create document");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="New document" description="Waivers, policies, and other forms members must sign." />

      <form onSubmit={onSubmit} className="space-y-6">
        <Card>
          <CardHeader title="Basics" />
          <div className="mt-4 grid grid-cols-1 gap-4">
            <Input label="Document name" required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Liability waiver" />
            <Textarea label="Description (optional)" rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Shown to members before they sign." />
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
            <Textarea
              rows={14}
              required
              className="font-mono text-apple-xs"
              value={form.body}
              onChange={(e) => set("body", e.target.value)}
              placeholder="Paste the full text of the document here…"
            />
            <label className="flex items-center gap-2 text-apple-xs text-apple-text-secondary">
              <input type="checkbox" className="h-3.5 w-3.5 accent-apple-blue" checked={form.format === "html"} onChange={(e) => set("format", e.target.checked ? "html" : "text")} />
              Content is HTML (otherwise plain text; paragraphs are separated by blank lines)
            </label>
          </div>
        </Card>

        <Card>
          <CardHeader title="Rules" />
          <div className="mt-4 space-y-5">
            <Toggle checked={form.requiredAtSignup} onChange={(v) => set("requiredAtSignup", v)} label="Required at signup" hint="New members must sign before their access is enabled." />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Expires after (days)" type="number" inputMode="numeric" min={1} value={form.expiresAfterDays} onChange={(e) => set("expiresAfterDays", e.target.value)} hint="Leave blank if a signature never expires (e.g. 365 for an annual waiver)." />
              <Input label="Grace period after expiry (days)" type="number" inputMode="numeric" min={0} value={form.graceAfterExpiryDays} onChange={(e) => set("graceAfterExpiryDays", e.target.value)} hint="Access is disabled this many days after the signature expires." />
            </div>
          </div>
        </Card>

        {error && <p className="text-apple-sm text-apple-red">{error}</p>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" type="button" onClick={() => router.push(adminRoutes.loc.members.documents(slug))}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Create document
          </Button>
        </div>
      </form>
    </div>
  );
}
