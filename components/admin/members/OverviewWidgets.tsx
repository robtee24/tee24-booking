"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, Plus, RefreshCw } from "lucide-react";
import { Button, Input, Modal, useToast } from "@/components/ui";
import { Toggle } from "@/components/admin/location-settings/SettingsSection";
import { TagChip, api, errMsg } from "./shared";

type Tag = { id: string; name: string; color: string | null };

/* ------------------------------------------------------------------ */
/* Tags editor                                                         */
/* ------------------------------------------------------------------ */

export function TagsEditor({ slug, memberId, tags: initial }: { slug: string; memberId: string; tags: Tag[] }) {
  const { toast } = useToast();
  const router = useRouter();
  const [tags, setTags] = React.useState(initial);
  const [adding, setAdding] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [all, setAll] = React.useState<Tag[]>([]);
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => setTags(initial), [initial]);

  React.useEffect(() => {
    if (!adding) return;
    api<{ tags: Tag[] }>(`/api/admin/tags?locationSlug=${encodeURIComponent(slug)}`).then((r) => setAll(r.tags ?? [])).catch(() => {});
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [adding, slug]);

  const existingIds = new Set(tags.map((t) => t.id));
  const q = query.trim().toLowerCase();
  const suggestions = all.filter((t) => !existingIds.has(t.id) && (!q || t.name.toLowerCase().includes(q))).slice(0, 8);
  const exactExists = all.some((t) => t.name.toLowerCase() === q);

  async function add(payload: { tagId?: string; name?: string }) {
    setBusy(true);
    try {
      const r = await api<{ tags: Tag[] }>(`/api/admin/members/${memberId}/tags`, { method: "POST", json: payload });
      setTags(r.tags);
      setQuery("");
      setAdding(false);
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't add tag", description: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(tagId: string) {
    const prev = tags;
    setTags((t) => t.filter((x) => x.id !== tagId));
    try {
      await api(`/api/admin/members/${memberId}/tags?tagId=${tagId}`, { method: "DELETE" });
      router.refresh();
    } catch (e) {
      setTags(prev);
      toast({ tone: "error", title: "Couldn't remove tag", description: errMsg(e) });
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.length === 0 && !adding && <span className="text-apple-sm text-apple-text-tertiary">No tags</span>}
        {tags.map((t) => (
          <TagChip key={t.id} name={t.name} color={t.color} onRemove={() => void remove(t.id)} />
        ))}
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-apple-border px-2 py-0.5 text-apple-xs text-apple-text-secondary hover:border-apple-blue hover:text-apple-blue">
            <Plus className="h-3 w-3" /> Add tag
          </button>
        )}
      </div>
      {adding && (
        <div className="relative">
          <Input
            ref={inputRef}
            value={query}
            placeholder="Search or create a tag…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setAdding(false); setQuery(""); }
              if (e.key === "Enter" && q) {
                e.preventDefault();
                const match = suggestions.find((t) => t.name.toLowerCase() === q) ?? suggestions[0];
                if (match && (exactExists || suggestions.length === 1)) void add({ tagId: match.id });
                else void add({ name: query.trim() });
              }
            }}
            disabled={busy}
          />
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-apple border border-apple-border bg-white shadow-apple-md">
            {suggestions.map((t) => (
              <button key={t.id} type="button" onClick={() => void add({ tagId: t.id })} className="flex w-full items-center gap-2 px-3 py-2 text-left text-apple-sm hover:bg-apple-fill-secondary">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.color ?? "#16a34a" }} />
                {t.name}
              </button>
            ))}
            {q && !exactExists && (
              <button type="button" onClick={() => void add({ name: query.trim() })} className="flex w-full items-center gap-2 px-3 py-2 text-left text-apple-sm text-apple-blue hover:bg-apple-fill-secondary">
                <Plus className="h-3.5 w-3.5" /> Create “{query.trim()}”
              </button>
            )}
            {suggestions.length === 0 && !q && <div className="px-3 py-2 text-apple-xs text-apple-text-tertiary">Type to search or create a tag. Esc to close.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Kisi toggle                                                         */
/* ------------------------------------------------------------------ */

export type KisiLinkRow = { kisiUserId: string; linkedAt: string; unlinkedAt: string | null; unlinkReason: string | null };

export function KisiAccessCard({ memberId, enabled: initial, reason, kisiUserId, history = [] }: { memberId: string; enabled: boolean; reason: string | null; kisiUserId: string | null; history?: KisiLinkRow[] }) {
  const { toast } = useToast();
  const router = useRouter();
  const [enabled, setEnabled] = React.useState(initial);
  const [confirm, setConfirm] = React.useState<null | boolean>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState<"toggle" | "resync" | null>(null);

  React.useEffect(() => setEnabled(initial), [initial]);

  async function apply(next: boolean) {
    setBusy("toggle");
    try {
      const r = await api<{ ok: boolean; enabled: boolean; warning?: string }>(`/api/admin/members/${memberId}/kisi`, { method: "POST", json: { enabled: next, reason: note.trim() || undefined } });
      setEnabled(r.enabled ?? next);
      toast({ tone: r.warning ? "info" : "success", title: next ? "Door access enabled" : "Door access disabled", description: r.warning });
      setConfirm(null);
      setNote("");
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't update door access", description: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }

  async function resync() {
    setBusy("resync");
    try {
      const r = await api<{ enabled: boolean }>(`/api/admin/members/${memberId}/kisi`, { method: "POST", json: { resync: true } });
      setEnabled(r.enabled);
      toast({ tone: "success", title: "Access re-evaluated from membership & billing" });
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't resync", description: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <Toggle
        checked={enabled}
        onChange={(v) => setConfirm(v)}
        label={enabled ? "Door access on" : "Door access off"}
        hint={reason ? `Reason: ${reason.replace(/_/g, " ")}` : "Follows membership status and billing automatically."}
      />
      <div className="flex flex-wrap items-center gap-2 text-apple-xs text-apple-text-tertiary">
        <span>{kisiUserId ? `Kisi user ${kisiUserId}` : enabled ? "Kisi user will be created on next sync" : "Not in Kisi (removed when access was turned off)"}</span>
        <button type="button" onClick={() => void resync()} disabled={busy !== null} className="inline-flex items-center gap-1 font-medium text-apple-blue hover:underline disabled:opacity-50">
          <RefreshCw className={`h-3 w-3 ${busy === "resync" ? "animate-spin" : ""}`} /> Re-sync from status
        </button>
      </div>

      {history.length > 0 && (
        <details className="text-apple-xs text-apple-text-tertiary">
          <summary className="cursor-pointer select-none">Kisi history ({history.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {history.map((h) => (
              <li key={`${h.kisiUserId}-${h.linkedAt}`}>
                User {h.kisiUserId} · added {new Date(h.linkedAt).toLocaleDateString()}{h.unlinkedAt ? ` · removed ${new Date(h.unlinkedAt).toLocaleDateString()}${h.unlinkReason ? ` (${h.unlinkReason})` : ""}` : " · current"}
              </li>
            ))}
          </ul>
        </details>
      )}

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm ? "Enable door access?" : "Disable door access?"}
        description={confirm
          ? "Creates (or re-creates) this member in Kisi and grants their plan's door groups. Kisi emails them a mobile-key invite; we send a confirmation."
          : "Removes this member from Kisi completely — mobile key, groups and shares. Their unlock history stays in Tee24. We notify the member. Automatic rules (membership, billing) can re-enable it on the next sync."}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant={confirm ? "primary" : "danger"} loading={busy === "toggle"} onClick={() => confirm !== null && void apply(confirm)}>
              {confirm ? "Enable access" : "Disable access"}
            </Button>
          </div>
        }
      >
        <Input label="Reason (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Comp week while card is replaced" />
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Check-in code                                                       */
/* ------------------------------------------------------------------ */

export function CheckinCodeCard({ memberId, code: initial }: { memberId: string; code: string | null }) {
  const { toast } = useToast();
  const router = useRouter();
  const [code, setCode] = React.useState(initial);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(initial ?? "");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => setCode(initial), [initial]);

  async function save(next?: string) {
    setBusy(true);
    try {
      const r = await api<{ checkinCode: string | null }>(`/api/admin/members/${memberId}/checkin-code`, { method: "POST", json: next === undefined ? {} : { code: next } });
      setCode(r.checkinCode);
      setEditing(false);
      toast({ tone: "success", title: next === undefined ? "New code generated" : "Check-in code saved" });
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't save code", description: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {editing ? (
        <div className="flex items-end gap-2">
          <Input
            label="4–8 digit code"
            inputMode="numeric"
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 8))}
            onKeyDown={(e) => { if (e.key === "Enter") void save(draft); if (e.key === "Escape") setEditing(false); }}
          />
          <Button size="md" onClick={() => void save(draft)} loading={busy} disabled={draft.length < 4}>Save</Button>
          <Button size="md" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-apple-sm bg-apple-fill-secondary px-3 py-2 font-mono text-apple-lg tracking-[0.3em] text-apple-text">
            <KeyRound className="h-4 w-4 text-apple-text-tertiary" />
            {code ?? "— — — —"}
          </div>
          {code && (
            <button type="button" className="rounded-apple-sm p-2 text-apple-text-tertiary hover:bg-apple-fill-secondary hover:text-apple-text" aria-label="Copy code" onClick={() => { void navigator.clipboard?.writeText(code); toast({ tone: "info", title: "Code copied" }); }}>
              <Copy className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
      {!editing && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => { setDraft(code ?? ""); setEditing(true); }}>{code ? "Change" : "Set code"}</Button>
          <Button size="sm" variant="secondary" iconLeft={<RefreshCw className="h-3.5 w-3.5" />} loading={busy} onClick={() => void save()}>Regenerate</Button>
        </div>
      )}
      <p className="text-apple-xs text-apple-text-tertiary">Members type this at the Front Desk kiosk to check in. Unique per location.</p>
    </div>
  );
}
