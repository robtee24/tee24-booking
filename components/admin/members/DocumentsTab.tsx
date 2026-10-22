"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink, FileSignature, FileText, Plus, Send, XCircle } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, Modal, Select, StatusBadge, useToast } from "@/components/ui";
import { Checkbox, ErrorBanner, LoadingRows, api, errMsg, fmtDate, fmtDateTime } from "./shared";

type Ev = { id: string; kind: string; createdAt: string; signedOnBehalfBy: string | null };
type Assignment = {
  id: string; status: string; versionAtAssign: number; expiresAt: string | null; signedAt: string | null; createdAt: string; signingUrl: string | null; pdfUrl: string | null;
  document: { id: string; name: string; requiredAtSignup: boolean; expiresAfterDays: number | null; version: number };
  events: Ev[];
};
type LibDoc = { id: string; name: string; requiredAtSignup: boolean; version: number; description: string | null };

export function DocumentsTab({ memberId }: { slug: string; memberId: string }) {
  const { toast } = useToast();
  const router = useRouter();
  const [data, setData] = React.useState<{ assignments: Assignment[]; library: LibDoc[] } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [resend, setResend] = React.useState<Assignment | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setError(null);
    api<{ assignments: Assignment[]; library: LibDoc[] }>(`/api/admin/members/${memberId}/documents`).then(setData).catch((e) => setError(errMsg(e)));
  }, [memberId]);
  React.useEffect(load, [load]);

  async function run(label: string, fn: () => Promise<unknown>, success: string) {
    setBusy(label);
    try {
      await fn();
      toast({ tone: "success", title: success });
      setAssignOpen(false);
      setResend(null);
      load();
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Action failed", description: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }

  function copy(url: string) {
    void navigator.clipboard?.writeText(url);
    toast({ tone: "info", title: "Signing link copied" });
  }

  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!data) return <LoadingRows n={3} />;

  const signedDocIds = new Set(data.assignments.filter((a) => a.status === "SIGNED").map((a) => a.document.id));
  const pendingDocIds = new Set(data.assignments.filter((a) => a.status === "SENT" || a.status === "VIEWED").map((a) => a.document.id));
  const missingRequired = data.library.filter((d) => d.requiredAtSignup && !signedDocIds.has(d.id));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-apple-lg font-semibold text-apple-text">Documents</h2>
        <Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => setAssignOpen(true)} disabled={data.library.length === 0}>Assign document</Button>
      </div>

      {missingRequired.length > 0 && (
        <div className="rounded-apple border border-apple-orange/30 bg-apple-orange/5 p-3 text-apple-sm text-apple-orange">
          Missing required: {missingRequired.map((d) => d.name).join(", ")}.
          {missingRequired.some((d) => !pendingDocIds.has(d.id)) && (
            <button type="button" className="ml-2 font-semibold underline" onClick={() => setAssignOpen(true)}>Assign now</button>
          )}
        </div>
      )}

      {data.assignments.length === 0 ? (
        <EmptyState icon={<FileText className="h-5 w-5" />} title="No documents assigned" description="Waivers and agreements sent to this member will appear here." />
      ) : (
        <ul className="space-y-3">
          {data.assignments.map((a) => {
            const open = a.status === "SENT" || a.status === "VIEWED";
            return (
              <Card key={a.id}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-apple-text">{a.document.name}</span>
                      <StatusBadge status={a.status} size="sm" />
                      {a.document.requiredAtSignup && <Badge tone="muted" size="sm">Required</Badge>}
                      {a.versionAtAssign !== a.document.version && <Badge tone="warn" size="sm">v{a.versionAtAssign} (current v{a.document.version})</Badge>}
                    </div>
                    <div className="text-apple-xs text-apple-text-tertiary">
                      Assigned {fmtDate(a.createdAt)}
                      {a.signedAt ? ` · Signed ${fmtDateTime(a.signedAt)}` : ""}
                      {a.expiresAt ? ` · Expires ${fmtDate(a.expiresAt)}` : ""}
                    </div>
                    {a.events.length > 0 && (
                      <div className="flex flex-wrap gap-x-3 text-apple-xs text-apple-text-tertiary">
                        {a.events.map((e) => <span key={e.id}>{e.kind.toLowerCase()} {fmtDateTime(e.createdAt)}{e.signedOnBehalfBy ? " (staff)" : ""}</span>)}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    {a.pdfUrl && (
                      <a href={a.pdfUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-apple-sm border border-apple-border bg-white px-3 text-apple-xs font-medium text-apple-text hover:bg-apple-fill-secondary">
                        <ExternalLink className="h-3.5 w-3.5" /> Signed PDF
                      </a>
                    )}
                    {open && a.signingUrl && (
                      <>
                        <a href={a.signingUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-apple-sm bg-apple-blue px-3 text-apple-xs font-medium text-white hover:bg-apple-blue-hover">
                          <FileSignature className="h-3.5 w-3.5" /> Sign now
                        </a>
                        <Button size="sm" variant="secondary" iconLeft={<Copy className="h-3.5 w-3.5" />} onClick={() => copy(a.signingUrl!)}>Copy link</Button>
                        <Button size="sm" variant="secondary" iconLeft={<Send className="h-3.5 w-3.5" />} onClick={() => setResend(a)}>Resend</Button>
                      </>
                    )}
                    {open && (
                      <Button size="sm" variant="danger" iconLeft={<XCircle className="h-3.5 w-3.5" />} loading={busy === `void-${a.id}`} onClick={() => { if (window.confirm("Void this document request?")) void run(`void-${a.id}`, () => api(`/api/admin/members/${memberId}/documents/${a.id}`, { method: "DELETE" }), "Document voided"); }}>
                        Void
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </ul>
      )}

      {assignOpen && (
        <AssignModal
          library={data.library}
          pendingDocIds={pendingDocIds}
          signedDocIds={signedDocIds}
          busy={busy === "assign"}
          onClose={() => setAssignOpen(false)}
          onSubmit={(b) => run("assign", () => api(`/api/admin/members/${memberId}/documents`, { method: "POST", json: b }), "Document assigned")}
        />
      )}
      {resend && (
        <ResendModal a={resend} busy={busy === "resend"} onClose={() => setResend(null)} onSubmit={(channel) => run("resend", () => api(`/api/admin/members/${memberId}/documents/${resend.id}`, { method: "POST", json: { channel } }), "Signing link resent")} />
      )}
    </div>
  );
}

function AssignModal({ library, pendingDocIds, signedDocIds, busy, onClose, onSubmit }: { library: LibDoc[]; pendingDocIds: Set<string>; signedDocIds: Set<string>; busy: boolean; onClose: () => void; onSubmit: (b: any) => void }) {
  const first = library.find((d) => !pendingDocIds.has(d.id) && !signedDocIds.has(d.id)) ?? library[0];
  const [documentId, setDocumentId] = React.useState(first?.id ?? "");
  const [expiresAt, setExpiresAt] = React.useState("");
  const [notifyEmail, setNotifyEmail] = React.useState(true);
  const [notifySms, setNotifySms] = React.useState(false);
  const doc = library.find((d) => d.id === documentId);
  return (
    <Modal open onClose={onClose} title="Assign document" description="Creates a signing request and (optionally) notifies the member." footer={
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button loading={busy} disabled={!documentId} onClick={() => onSubmit({ documentId, expiresAt: expiresAt || undefined, notifyEmail, notifySms })}>Assign</Button>
      </div>
    }>
      <div className="space-y-3">
        <Select label="Document" value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
          {library.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} (v{d.version}){d.requiredAtSignup ? " · required" : ""}{signedDocIds.has(d.id) ? " · already signed" : pendingDocIds.has(d.id) ? " · pending" : ""}
            </option>
          ))}
        </Select>
        {doc?.description && <p className="text-apple-xs text-apple-text-tertiary">{doc.description}</p>}
        <Input label="Expires (optional)" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        <Checkbox label="Email the signing link" checked={notifyEmail} onChange={setNotifyEmail} />
        <Checkbox label="Text the signing link" checked={notifySms} onChange={setNotifySms} />
      </div>
    </Modal>
  );
}

function ResendModal({ a, busy, onClose, onSubmit }: { a: Assignment; busy: boolean; onClose: () => void; onSubmit: (channel: string) => void }) {
  const [channel, setChannel] = React.useState("EMAIL");
  return (
    <Modal open onClose={onClose} title={`Resend “${a.document.name}”`} footer={
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button loading={busy} onClick={() => onSubmit(channel)}>Resend</Button>
      </div>
    }>
      <Select label="Send via" value={channel} onChange={(e) => setChannel(e.target.value)}>
        <option value="EMAIL">Email</option>
        <option value="SMS">Text message</option>
        <option value="BOTH">Both</option>
      </Select>
    </Modal>
  );
}
