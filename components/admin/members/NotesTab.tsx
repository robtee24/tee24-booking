"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Lock, StickyNote } from "lucide-react";
import { Badge, Button, Card, EmptyState, Textarea, useToast } from "@/components/ui";
import { Checkbox, ErrorBanner, LoadingRows, api, errMsg, fmtDateTime } from "./shared";

type Note = { id: string; body: string; authorName: string; createdAt: string };
type Data = { notes: Note[]; internal: Note[]; canViewInternal: boolean };

export function NotesTab({ memberId }: { slug: string; memberId: string }) {
  const { toast } = useToast();
  const router = useRouter();
  const [data, setData] = React.useState<Data | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [body, setBody] = React.useState("");
  const [internal, setInternal] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [view, setView] = React.useState<"ALL" | "NOTES" | "INTERNAL">("ALL");

  const load = React.useCallback(() => {
    setError(null);
    api<Data>(`/api/admin/members/${memberId}/notes`).then(setData).catch((e) => setError(errMsg(e)));
  }, [memberId]);
  React.useEffect(load, [load]);

  async function save() {
    if (!body.trim()) return;
    setSaving(true);
    try {
      await api(`/api/admin/members/${memberId}/notes`, { method: "POST", json: { body: body.trim(), internal } });
      setBody("");
      toast({ tone: "success", title: internal ? "Internal note added" : "Note added" });
      load();
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't save note", description: errMsg(e) });
    } finally {
      setSaving(false);
    }
  }

  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!data) return <LoadingRows n={3} />;

  const all = [
    ...data.notes.map((n) => ({ ...n, internal: false })),
    ...data.internal.map((n) => ({ ...n, internal: true })),
  ]
    .filter((n) => view === "ALL" || (view === "INTERNAL" ? n.internal : !n.internal))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-apple-lg font-semibold text-apple-text">Notes</h2>
        {data.canViewInternal && (
          <div className="flex gap-1">
            {(["ALL", "NOTES", "INTERNAL"] as const).map((f) => (
              <button key={f} type="button" onClick={() => setView(f)} className={`rounded-apple-pill px-3 py-1 text-apple-xs font-medium ${view === f ? "bg-apple-text text-white" : "bg-apple-fill-secondary text-apple-text-secondary"}`}>
                {f === "ALL" ? "All" : f === "NOTES" ? "Staff notes" : "Internal"}
              </button>
            ))}
          </div>
        )}
      </div>

      <Card>
        <Textarea rows={3} placeholder="Add a note about this member…" value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void save(); }} />
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {data.canViewInternal ? (
            <Checkbox label="Internal (managers only)" checked={internal} onChange={setInternal} />
          ) : (
            <span className="text-apple-xs text-apple-text-tertiary">Visible to all staff</span>
          )}
          <Button loading={saving} disabled={!body.trim()} onClick={() => void save()}>Add note</Button>
        </div>
      </Card>

      {all.length === 0 ? (
        <EmptyState icon={<StickyNote className="h-5 w-5" />} title="No notes" description="Keep context about this member for the rest of the team." />
      ) : (
        <ul className="space-y-3">
          {all.map((n) => (
            <li key={`${n.internal ? "i" : "n"}-${n.id}`} className={`rounded-apple border p-4 ${n.internal ? "border-apple-orange/30 bg-apple-orange/5" : "border-apple-border bg-white"}`}>
              <div className="mb-1 flex flex-wrap items-center gap-2 text-apple-xs text-apple-text-tertiary">
                <span className="font-medium text-apple-text-secondary">{n.authorName}</span>
                <span>·</span>
                <span>{fmtDateTime(n.createdAt)}</span>
                {n.internal && <Badge tone="warn" size="sm"><Lock className="mr-1 inline h-3 w-3" />Internal</Badge>}
              </div>
              <p className="whitespace-pre-wrap text-apple-sm text-apple-text">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
