"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Footprints, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card, Column, DataTable, EmptyState, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import { ErrorBanner, LoadingRows, api, errMsg, fmtDateTime, toDateInput } from "./shared";

type Visit = { id: string; type: string; source: string; enteredAt: string; exitedAt: string | null; unlockCount: number; notes: string | null; bookingId: string | null; bay: { number: number; name: string | null } | null };
type Data = { items: Visit[]; total: number; page: number; pageSize: number; totals: { thisMonth: number; last90: number; allTime: number } };

const TYPES = ["MANUAL", "WALK_IN", "RESERVATION", "DAY_PASS", "CLASS"];

function toLocalInput(d: string | Date): string {
  const dt = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${toDateInput(dt)}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

export function AttendanceTab({ memberId }: { slug: string; memberId: string }) {
  const { toast } = useToast();
  const router = useRouter();
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<Data | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [modal, setModal] = React.useState<null | { kind: "add" } | { kind: "edit"; visit: Visit }>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    setError(null);
    api<Data>(`/api/admin/members/${memberId}/visits?page=${page}&pageSize=25`).then(setData).catch((e) => setError(errMsg(e)));
  }, [memberId, page]);
  React.useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await fn();
      toast({ tone: "success", title: success });
      setModal(null);
      load();
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Action failed", description: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!data) return <LoadingRows n={3} />;

  const columns: Column<Visit>[] = [
    { key: "enteredAt", header: "When", cell: (v) => <span className="text-apple-text">{fmtDateTime(v.enteredAt)}</span> },
    { key: "type", header: "Type", cell: (v) => <span className="text-apple-text-secondary">{v.type.replace(/_/g, " ").toLowerCase()}</span> },
    { key: "source", header: "Source", cell: (v) => <Badge tone="muted" size="sm">{v.source.replace(/_/g, " ").toLowerCase()}</Badge> },
    { key: "bay", header: "Bay", cell: (v) => (v.bay ? `Bay ${v.bay.number}` : "—") },
    { key: "unlocks", header: "Unlocks", align: "right", cell: (v) => (v.unlockCount > 1 ? `×${v.unlockCount}` : "") },
    { key: "notes", header: "Notes", cell: (v) => <span className="line-clamp-1 text-apple-text-tertiary">{v.notes ?? ""}</span> },
    {
      key: "actions", header: "", align: "right",
      cell: (v) => (
        <div className="flex justify-end gap-1">
          <button type="button" className="rounded p-1.5 text-apple-text-tertiary hover:bg-apple-fill-secondary hover:text-apple-text" aria-label="Edit visit" onClick={() => setModal({ kind: "edit", visit: v })}><Pencil className="h-3.5 w-3.5" /></button>
          <button type="button" className="rounded p-1.5 text-apple-text-tertiary hover:bg-apple-fill-secondary hover:text-apple-red" aria-label="Delete visit" onClick={() => { if (window.confirm("Delete this visit?")) void run(() => api(`/api/admin/members/${memberId}/visits/${v.id}`, { method: "DELETE" }), "Visit deleted"); }}><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ),
    },
  ];
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-apple-lg font-semibold text-apple-text">Attendance</h2>
        <Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => setModal({ kind: "add" })}>Add visit</Button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="This month" value={data.totals.thisMonth} />
        <Stat label="Last 90 days" value={data.totals.last90} />
        <Stat label="All time" value={data.totals.allTime} />
      </div>
      {data.total === 0 ? (
        <EmptyState icon={<Footprints className="h-5 w-5" />} title="No visits yet" description="Door unlocks, front-desk check-ins and bay-app check-ins land here." action={<Button onClick={() => setModal({ kind: "add" })}>Add manual visit</Button>} />
      ) : (
        <>
          <DataTable columns={columns} rows={data.items} rowKey={(v) => v.id} density="compact" />
          {pages > 1 && (
            <div className="flex items-center justify-between text-apple-xs text-apple-text-secondary">
              <span>Page {data.page} of {pages} · {data.total} visits</span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}

      {modal && (
        <VisitModal
          visit={modal.kind === "edit" ? modal.visit : null}
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={(b) =>
            modal.kind === "edit"
              ? run(() => api(`/api/admin/members/${memberId}/visits/${modal.visit.id}`, { method: "PATCH", json: b }), "Visit updated")
              : run(() => api(`/api/admin/members/${memberId}/visits`, { method: "POST", json: b }), "Visit added")
          }
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <div className="text-apple-xs uppercase tracking-wide text-apple-text-tertiary">{label}</div>
      <div className="mt-1 text-apple-xl font-semibold text-apple-text">{value}</div>
    </Card>
  );
}

function VisitModal({ visit, busy, onClose, onSubmit }: { visit: Visit | null; busy: boolean; onClose: () => void; onSubmit: (b: any) => void }) {
  const [enteredAt, setEnteredAt] = React.useState(toLocalInput(visit?.enteredAt ?? new Date()));
  const [type, setType] = React.useState(visit?.type ?? "MANUAL");
  const [notes, setNotes] = React.useState(visit?.notes ?? "");
  return (
    <Modal open onClose={onClose} title={visit ? "Edit visit" : "Add manual visit"} footer={
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button loading={busy} onClick={() => onSubmit({ enteredAt: new Date(enteredAt).toISOString(), type, notes: notes || null })}>{visit ? "Save" : "Add visit"}</Button>
      </div>
    }>
      <div className="space-y-3">
        <Input label="Date & time" type="datetime-local" value={enteredAt} onChange={(e) => setEnteredAt(e.target.value)} />
        <Select label="Type" value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ").toLowerCase()}</option>)}
        </Select>
        <Textarea label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}
