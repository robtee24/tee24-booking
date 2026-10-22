"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GitMerge, Mail, Phone, RefreshCw, Users } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { Badge, Button, Card, EmptyState, Modal, StatusBadge, useToast } from "@/components/ui";
import { Avatar, ErrorBanner, LoadingRows, api, errMsg, fmtDate, relTime } from "./shared";

type DupMember = { id: string; firstName: string; lastName: string; email: string; phone: string; status: string; joinDate: string | null; createdAt: string; photoUrl: string | null; membershipType: string | null; counts: { visits: number; invoices: number; subscriptions: number; documents: number; notes: number }; lastVisitAt: string | null };
type Group = { key: string; reason: "email" | "phone"; members: DupMember[] };

export function MergeDuplicates({ slug }: { slug: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [groups, setGroups] = React.useState<Group[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [survivors, setSurvivors] = React.useState<Record<string, string>>({});
  const [confirm, setConfirm] = React.useState<Group | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    setError(null);
    setGroups(null);
    api<{ groups: Group[] }>(`/api/admin/members/duplicates?locationSlug=${encodeURIComponent(slug)}`)
      .then((r) => {
        setGroups(r.groups);
        // Default survivor: the record with the most activity, tie → oldest.
        setSurvivors(Object.fromEntries(r.groups.map((g) => [g.key, pickDefault(g.members).id])));
      })
      .catch((e) => setError(errMsg(e)));
  }, [slug]);
  React.useEffect(load, [load]);

  async function merge(g: Group) {
    const survivorId = survivors[g.key];
    const loserIds = g.members.filter((m) => m.id !== survivorId).map((m) => m.id);
    setBusy(true);
    try {
      const r = await api<{ moved: Record<string, number> }>(`/api/admin/members/merge`, { method: "POST", json: { locationSlug: slug, survivorId, loserIds } });
      const movedCount = Object.values(r.moved ?? {}).reduce((a, b) => a + b, 0);
      toast({ tone: "success", title: `Merged ${loserIds.length} record${loserIds.length === 1 ? "" : "s"}`, description: movedCount ? `${movedCount} linked items moved` : undefined });
      setConfirm(null);
      load();
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Merge failed", description: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!groups) return <LoadingRows n={3} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-apple-sm text-apple-text-secondary">{groups.length === 0 ? "No duplicates detected." : `${groups.length} duplicate group${groups.length === 1 ? "" : "s"} found.`}</p>
        <Button variant="secondary" size="sm" iconLeft={<RefreshCw className="h-3.5 w-3.5" />} onClick={load}>Rescan</Button>
      </div>

      {groups.length === 0 ? (
        <EmptyState icon={<Users className="h-5 w-5" />} title="All clean" description="No two members share an email address or phone number." />
      ) : (
        groups.map((g) => {
          const survivorId = survivors[g.key];
          return (
            <Card key={g.key}>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-apple-sm">
                {g.reason === "email" ? <Mail className="h-4 w-4 text-apple-text-tertiary" /> : <Phone className="h-4 w-4 text-apple-text-tertiary" />}
                <span className="font-medium text-apple-text">Same {g.reason}:</span>
                <span className="text-apple-text-secondary">{g.key}</span>
                <Badge tone="muted" size="sm">{g.members.length} records</Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {g.members.map((m) => {
                  const keep = m.id === survivorId;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSurvivors((s) => ({ ...s, [g.key]: m.id }))}
                      className={`rounded-apple border p-3 text-left transition-colors ${keep ? "border-apple-blue bg-apple-blue/5 ring-2 ring-apple-blue/20" : "border-apple-border hover:bg-apple-fill-secondary/50"}`}
                    >
                      <div className="flex items-start gap-3">
                        <Avatar photoUrl={m.photoUrl} first={m.firstName} last={m.lastName} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold text-apple-text">{m.firstName} {m.lastName}</span>
                            <StatusBadge status={m.status} size="sm" />
                            {keep ? <Badge tone="info" size="sm">Keep</Badge> : <Badge tone="muted" size="sm">Merge into keep</Badge>}
                          </div>
                          <div className="truncate text-apple-xs text-apple-text-tertiary">{m.email}</div>
                          <div className="truncate text-apple-xs text-apple-text-tertiary">{m.phone || "no phone"}{m.membershipType ? ` · ${m.membershipType}` : ""}</div>
                        </div>
                      </div>
                      <dl className="mt-3 grid grid-cols-3 gap-1 text-center text-[11px] text-apple-text-tertiary">
                        <Count label="visits" n={m.counts.visits} />
                        <Count label="invoices" n={m.counts.invoices} />
                        <Count label="plans" n={m.counts.subscriptions} />
                        <Count label="docs" n={m.counts.documents} />
                        <Count label="notes" n={m.counts.notes} />
                        <div><dd className="text-apple-sm font-semibold text-apple-text">{relTime(m.lastVisitAt)}</dd><dt>last visit</dt></div>
                      </dl>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-apple-text-tertiary">
                        <span>Joined {fmtDate(m.joinDate ?? m.createdAt)}</span>
                        <Link href={adminRoutes.loc.members.detail(slug, m.id)} className="text-apple-blue hover:underline" onClick={(e) => e.stopPropagation()}>Open</Link>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex justify-end">
                <Button iconLeft={<GitMerge className="h-4 w-4" />} onClick={() => setConfirm(g)}>Merge {g.members.length - 1} into kept record</Button>
              </div>
            </Card>
          );
        })
      )}

      {confirm && (
        <Modal open onClose={() => setConfirm(null)} title="Merge these records?" description="This can't be undone. Merged records are kept as read-only history pointing at the survivor." footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button>
            <Button variant="danger" loading={busy} onClick={() => void merge(confirm)}>Merge now</Button>
          </div>
        }>
          <ul className="space-y-1 text-apple-sm">
            {confirm.members.map((m) => (
              <li key={m.id} className="flex items-center justify-between">
                <span className="text-apple-text">{m.firstName} {m.lastName} <span className="text-apple-text-tertiary">· {m.email}</span></span>
                {m.id === survivors[confirm.key] ? <Badge tone="info" size="sm">Keep</Badge> : <Badge tone="warn" size="sm">Merge</Badge>}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-apple-xs text-apple-text-tertiary">Visits, invoices, charges, subscriptions, documents, notes, messages, credits, family links and tags all move to the kept record. Blank fields on the kept record are filled from the merged ones; extra emails/phones become secondary contacts.</p>
        </Modal>
      )}
    </div>
  );
}

function Count({ label, n }: { label: string; n: number }) {
  return (
    <div>
      <dd className="text-apple-sm font-semibold text-apple-text">{n}</dd>
      <dt>{label}</dt>
    </div>
  );
}

function pickDefault(ms: DupMember[]): DupMember {
  const score = (m: DupMember) => m.counts.visits * 2 + m.counts.invoices * 3 + m.counts.subscriptions * 5 + m.counts.documents + m.counts.notes + (m.status === "ACTIVE" ? 10 : 0);
  return [...ms].sort((a, b) => score(b) - score(a) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];
}
