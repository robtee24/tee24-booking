"use client";

import React from "react";
import { Database, Pencil, Plus, Trash2 } from "lucide-react";
import { Button, Card, EmptyState, Input, Modal, PageHeader, Select, useToast } from "@/components/ui";
import { Checkbox, api, errMsg } from "./shared";

type Field = {
  id: string;
  name: string;
  key: string;
  type: string;
  options: unknown;
  required: boolean;
  showOnSignup: boolean;
  showOnProfile: boolean;
  adminOnly: boolean;
};

const TYPES = [
  { id: "TEXT", label: "Text" },
  { id: "NUMBER", label: "Number" },
  { id: "DATE", label: "Date" },
  { id: "BOOLEAN", label: "Yes / no" },
  { id: "SELECT", label: "Single select" },
  { id: "MULTI_SELECT", label: "Multi select" },
];

export function CustomFieldsManager({ slug, initial }: { slug: string; initial: Field[] }) {
  const { toast } = useToast();
  const [fields, setFields] = React.useState(initial);
  const [modal, setModal] = React.useState<null | { mode: "create" } | { mode: "edit"; field: Field }>(null);
  const [busy, setBusy] = React.useState(false);

  async function reload() {
    const r = await api<{ fields: Field[] }>(`/api/admin/custom-fields?locationSlug=${encodeURIComponent(slug)}`);
    setFields(r.fields ?? []);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Custom fields"
        description="Add additional questions to signup forms and member profiles."
        actions={<Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => setModal({ mode: "create" })}>New field</Button>}
      />
      {fields.length === 0 ? (
        <EmptyState icon={<Database className="h-6 w-6" />} title="No custom fields" description="Collect extra info at signup or on the member profile." />
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-apple-divider">
            {fields.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 p-4">
                <div>
                  <div className="font-medium text-apple-text">{f.name}</div>
                  <div className="text-apple-xs text-apple-text-tertiary">
                    {f.key} · {f.type.toLowerCase().replace("_", " ")}
                    {f.required ? " · required" : ""}
                    {f.showOnSignup ? " · signup" : ""}
                    {f.adminOnly ? " · staff only" : ""}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" iconLeft={<Pencil className="h-3.5 w-3.5" />} onClick={() => setModal({ mode: "edit", field: f })}>Edit</Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    iconLeft={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={() => {
                      if (!window.confirm(`Delete “${f.name}”? Stored answers on members will be removed.`)) return;
                      setBusy(true);
                      api(`/api/admin/custom-fields/${f.id}?locationSlug=${encodeURIComponent(slug)}`, { method: "DELETE" })
                        .then(() => { toast({ tone: "success", title: "Field deleted" }); return reload(); })
                        .catch((e) => toast({ tone: "error", title: "Couldn't delete field", description: errMsg(e) }))
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
        <FieldModal
          initial={modal.mode === "edit" ? modal.field : null}
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={async (body) => {
            setBusy(true);
            try {
              if (modal.mode === "edit") await api(`/api/admin/custom-fields/${modal.field.id}`, { method: "PATCH", json: { locationSlug: slug, ...body } });
              else await api("/api/admin/custom-fields", { method: "POST", json: { locationSlug: slug, ...body } });
              toast({ tone: "success", title: modal.mode === "edit" ? "Field updated" : "Field created" });
              await reload();
              setModal(null);
            } catch (e) {
              toast({ tone: "error", title: "Couldn't save field", description: errMsg(e) });
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

function FieldModal({ initial, busy, onClose, onSubmit }: { initial: Field | null; busy: boolean; onClose: () => void; onSubmit: (b: Record<string, unknown>) => void }) {
  const [name, setName] = React.useState(initial?.name ?? "");
  const [type, setType] = React.useState(initial?.type ?? "TEXT");
  const [options, setOptions] = React.useState(Array.isArray(initial?.options) ? (initial!.options as string[]).join(", ") : "");
  const [required, setRequired] = React.useState(initial?.required ?? false);
  const [showOnSignup, setShowOnSignup] = React.useState(initial?.showOnSignup ?? false);
  const [showOnProfile, setShowOnProfile] = React.useState(initial?.showOnProfile ?? true);
  const [adminOnly, setAdminOnly] = React.useState(initial?.adminOnly ?? false);
  const needsOptions = type === "SELECT" || type === "MULTI_SELECT";
  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? "Edit field" : "New field"}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={!name.trim() || (needsOptions && !options.trim())} onClick={() => onSubmit({ name: name.trim(), type, options: options.split(",").map((s) => s.trim()).filter(Boolean), required, showOnSignup, showOnProfile, adminOnly })}>Save</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <Select label="Type" value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </Select>
        {needsOptions && <Input label="Options (comma separated)" value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Gold, Silver, Bronze" />}
        <Checkbox label="Required" checked={required} onChange={setRequired} />
        <Checkbox label="Show on signup" checked={showOnSignup} onChange={setShowOnSignup} />
        <Checkbox label="Show on member profile" checked={showOnProfile} onChange={setShowOnProfile} />
        <Checkbox label="Staff only (hidden from the member)" checked={adminOnly} onChange={setAdminOnly} />
      </div>
    </Modal>
  );
}
