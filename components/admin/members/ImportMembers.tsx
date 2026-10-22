"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileUp, Upload } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { Badge, Button, Card, CardHeader, Select, useToast } from "@/components/ui";
import { Checkbox, errMsg } from "./shared";

type Result = { ok: boolean; provider: string; dryRun: boolean; total: number; created: number; updated: number; skipped: number; errors: Array<{ row: number; email: string; error: string }> };

const PROVIDERS = [
  { value: "gymdesk", label: "GymDesk", hint: "Members export from GymDesk → Members → Export. Columns: Name, Email, Phone, Membership, Status, Tags, Created…" },
  { value: "generic", label: "Generic CSV", hint: "Columns: first_name, last_name, email, phone, dob, joined, status, tags (plus optional gender, membership, id)." },
];

export function ImportMembers({ slug }: { slug: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [provider, setProvider] = React.useState("gymdesk");
  const [file, setFile] = React.useState<File | null>(null);
  const [dryRun, setDryRun] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<Result | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function run() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("locationSlug", slug);
      fd.set("provider", provider);
      fd.set("dryRun", dryRun ? "1" : "0");
      const res = await fetch("/api/admin/members/import", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Import failed (${res.status})`);
      setResult(json as Result);
      if (!dryRun) {
        toast({ tone: "success", title: `Imported ${json.created} new, updated ${json.updated}` });
        router.refresh();
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const prov = PROVIDERS.find((p) => p.value === provider)!;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader title="1. Source" />
          <div className="mt-4 space-y-2">
            <Select label="Provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
              {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
            <p className="text-apple-xs text-apple-text-tertiary">{prov.hint}</p>
          </div>
        </Card>

        <Card>
          <CardHeader title="2. File" />
          <div
            className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-apple border-2 border-dashed px-6 py-10 text-center transition-colors ${dragOver ? "border-apple-blue bg-apple-blue/5" : "border-apple-border hover:bg-apple-fill-secondary/50"}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) { setFile(f); setResult(null); } }}
          >
            <FileUp className="mb-2 h-6 w-6 text-apple-text-tertiary" />
            {file ? (
              <>
                <div className="text-apple-sm font-medium text-apple-text">{file.name}</div>
                <div className="text-apple-xs text-apple-text-tertiary">{(file.size / 1024).toFixed(1)} KB · click to change</div>
              </>
            ) : (
              <>
                <div className="text-apple-sm font-medium text-apple-text">Drop a CSV here or click to browse</div>
                <div className="text-apple-xs text-apple-text-tertiary">.csv up to a few thousand rows</div>
              </>
            )}
            <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); setResult(null); }} />
          </div>
        </Card>

        <Card>
          <CardHeader title="3. Run" />
          <div className="mt-4 space-y-3">
            <Checkbox label="Dry run (validate only, change nothing)" checked={dryRun} onChange={setDryRun} hint="Recommended first. Shows what would be created/updated and any row errors." />
            {error && <div className="rounded-apple border border-apple-red/30 bg-apple-red/5 p-3 text-apple-sm text-apple-red">{error}</div>}
            <div className="flex gap-2">
              <Button iconLeft={<Upload className="h-4 w-4" />} loading={busy} disabled={!file} onClick={() => void run()}>{dryRun ? "Validate CSV" : "Import now"}</Button>
              {result?.dryRun && result.errors.length === 0 && (
                <Button variant="secondary" loading={busy} onClick={() => { setDryRun(false); setTimeout(() => void run(), 0); }}>Looks good — import for real</Button>
              )}
            </div>
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader title="Results" />
          {!result ? (
            <p className="mt-3 text-apple-sm text-apple-text-tertiary">Run a validation to see a summary here.</p>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="flex items-center gap-2 text-apple-sm">
                <CheckCircle2 className="h-4 w-4 text-apple-green" />
                <span className="text-apple-text">{result.dryRun ? "Validated" : "Imported"} {result.total} rows</span>
                <Badge tone="muted" size="sm">{result.provider}</Badge>
              </div>
              <dl className="grid grid-cols-3 gap-2 text-center">
                <Stat label={result.dryRun ? "Would create" : "Created"} value={result.created} tone="text-apple-green" />
                <Stat label={result.dryRun ? "Would update" : "Updated"} value={result.updated} tone="text-apple-blue" />
                <Stat label="Skipped" value={result.skipped} tone={result.skipped ? "text-apple-orange" : "text-apple-text"} />
              </dl>
              {!result.dryRun && (
                <Link href={adminRoutes.loc.members.list(slug)} className="block text-apple-sm font-medium text-apple-blue hover:underline">View members →</Link>
              )}
            </div>
          )}
        </Card>

        {result && result.errors.length > 0 && (
          <Card padded={false}>
            <div className="px-4 pt-4"><CardHeader title={`Row errors (${result.errors.length})`} subtitle="These rows were skipped." /></div>
            <ul className="mt-2 max-h-96 divide-y divide-apple-divider overflow-y-auto">
              {result.errors.map((e, i) => (
                <li key={i} className="px-4 py-2 text-apple-xs">
                  <span className="font-medium text-apple-text">Row {e.row}</span>
                  {e.email && <span className="text-apple-text-tertiary"> · {e.email}</span>}
                  <div className="text-apple-red">{e.error}</div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-apple-sm bg-apple-fill-secondary p-2">
      <dd className={`text-apple-lg font-semibold ${tone}`}>{value}</dd>
      <dt className="text-[10px] uppercase tracking-wide text-apple-text-tertiary">{label}</dt>
    </div>
  );
}
