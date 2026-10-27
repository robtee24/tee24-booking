"use client";

import React from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button, Card, EmptyState, Input, Modal, PageHeader, useToast } from "@/components/ui";
import { Tag as TagIcon } from "lucide-react";
import { api, errMsg } from "./shared";

type Tag = { id: string; name: string; color: string | null; memberCount: number };

const COLORS = ["#16a34a", "#2563eb", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#111827", "#db2777"];

export function TagsManager({ slug, initial }: { slug: string; initial: Tag[] }) {
  const { toast } = useToast();
  const [tags, setTags] = React.useState(initial);
  const [modal, setModal] = React.useState<null | { mode: "create" } | { mode: "edit"; tag: Tag }>(null);
  const [busy, setBusy] = React.useState(false);

  async function reload() {
    const r = await api<{ tags: Tag[] }>(`/api/admin/tags?locationSlug=${encodeURIComponent(slug)}`);
    setTags(r.tags ?? []);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tags"
        description="Tag members for filtering, segmentation, and automation triggers."
        actions={<Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => setModal({ mode: "create" })}>New tag</Button>}
      />

      {tags.length === 0 ? (
        <EmptyState icon={<TagIcon className="h-6 w-6" />} title="No tags yet" description="Tags help organize members for marketing & operations." />
      ) : (
        <Card>
          <ul className="divide-y divide-apple-divider">
            {tags.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: t.color ?? "#16a34a" }} />
                  <span className="font-medium text-apple-text">{t.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-apple-sm text-apple-text-tertiary">{t.memberCount} members</span>
                  <Button size="sm" variant="ghost" iconLeft={<Pencil className="h-3.5 w-3.5" />} onClick={() => setModal({ mode: "edit", tag: t })}>Edit</Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    iconLeft={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={() => {
                      if (!window.confirm(`Delete “${t.name}”? It will be removed from ${t.memberCount} member${t.memberCount === 1 ? "" : "s"}.`)) return;
                      setBusy(true);
                      api(`/api/admin/tags/${t.id}?locationSlug=${encodeURIComponent(slug)}`, { method: "DELETE" })
                        .then(() => { toast({ tone: "success", title: "Tag deleted" }); return reload(); })
                        .catch((e) => toast({ tone: "error", title: "Couldn't delete tag", description: errMsg(e) }))
                        .finally(() => setBusy(false));
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {modal && (
        <TagModal
          slug={slug}
          initial={modal.mode === "edit" ? modal.tag : { name: "", color: COLORS[0] }}
          title={modal.mode === "edit" ? "Edit tag" : "New tag"}
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={async (body) => {
            setBusy(true);
            try {
              if (modal.mode === "edit") await api(`/api/admin/tags/${modal.tag.id}`, { method: "PATCH", json: { locationSlug: slug, ...body } });
              else await api("/api/admin/tags", { method: "POST", json: { locationSlug: slug, ...body } });
              toast({ tone: "success", title: modal.mode === "edit" ? "Tag updated" : "Tag created" });
              await reload();
              setModal(null);
            } catch (e) {
              toast({ tone: "error", title: "Couldn't save tag", description: errMsg(e) });
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

function TagModal({ slug, initial, title, busy, onClose, onSubmit }: { slug: string; initial: { name: string; color?: string | null }; title: string; busy: boolean; onClose: () => void; onSubmit: (b: { name: string; color: string }) => void }) {
  void slug;
  const [name, setName] = React.useState(initial.name);
  const [color, setColor] = React.useState(initial.color ?? COLORS[0]);
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={!name.trim()} onClick={() => onSubmit({ name: name.trim(), color })}>Save</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <div>
          <div className="mb-1.5 text-apple-xs font-medium text-apple-text-secondary">Color</div>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`h-7 w-7 rounded-full border-2 ${color === c ? "border-apple-text" : "border-transparent"}`}
                style={{ backgroundColor: c }}
                aria-label={c}
              />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
