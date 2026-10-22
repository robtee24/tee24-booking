"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Crown, Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { Badge, Button, Card, CardHeader, EmptyState, Input, Modal, Money, Select, StatusBadge, useToast } from "@/components/ui";
import { Avatar, ErrorBanner, LoadingRows, ageFromDob, api, errMsg } from "./shared";

type FamMember = { id: string; memberId: string; role: string; isPrimary: boolean; firstName: string; lastName: string; email: string; phone: string; status: string; photoUrl: string | null; dob: string | null; subscription: { planName: string; status: string } | null; hasSharedCard: boolean };
type Family = { id: string; name: string; primaryMemberId: string | null; balanceCents: number; sharedCards: { id: string; memberId: string; brand: string | null; last4: string | null }[]; members: FamMember[] };
type SearchRow = { id: string; firstName: string; lastName: string; email: string; status: string };

const ROLES = ["SPOUSE", "CHILD", "PARENT", "GUARDIAN", "OTHER"];

export function FamilyTab({ slug, memberId }: { slug: string; memberId: string }) {
  const { toast } = useToast();
  const router = useRouter();
  const [family, setFamily] = React.useState<Family | null | undefined>(undefined);
  const [error, setError] = React.useState<string | null>(null);
  const [modal, setModal] = React.useState<null | { kind: "create" } | { kind: "add" } | { kind: "rename" } | { kind: "role"; m: FamMember }>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    setError(null);
    api<{ family: Family | null }>(`/api/admin/family?memberId=${memberId}`).then((r) => setFamily(r.family)).catch((e) => setError(errMsg(e)));
  }, [memberId]);
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
  if (family === undefined) return <LoadingRows n={2} />;

  if (!family) {
    return (
      <div className="space-y-4">
        <h2 className="text-apple-lg font-semibold text-apple-text">Family</h2>
        <EmptyState
          icon={<Users className="h-5 w-5" />}
          title="Not part of a family"
          description="Create a family group to link spouses, kids and dependants. The primary member's card can be shared across the group."
          action={<Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => setModal({ kind: "create" })}>Create family</Button>}
        />
        {modal?.kind === "create" && (
          <NameModal title="Create family" initial="" busy={busy} onClose={() => setModal(null)} onSubmit={(name) => run(() => api(`/api/admin/family`, { method: "POST", json: { primaryMemberId: memberId, name } }), "Family created")} />
        )}
      </div>
    );
  }

  const me = family.members.find((m) => m.memberId === memberId);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-apple-lg font-semibold text-apple-text">{family.name}</h2>
          <button type="button" onClick={() => setModal({ kind: "rename" })} className="rounded p-1 text-apple-text-tertiary hover:bg-apple-fill-secondary hover:text-apple-text" aria-label="Rename family"><Pencil className="h-3.5 w-3.5" /></button>
        </div>
        <Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => setModal({ kind: "add" })}>Add member</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <div className="text-apple-xs uppercase tracking-wide text-apple-text-tertiary">Shared cards</div>
          {family.sharedCards.length === 0 ? (
            <p className="mt-1 text-apple-sm text-apple-text-tertiary">None — the primary member can mark a card as shared from the portal.</p>
          ) : (
            <ul className="mt-1 text-apple-sm text-apple-text">{family.sharedCards.map((c) => <li key={c.id}>{c.brand ?? "Card"} •••• {c.last4}</li>)}</ul>
          )}
        </Card>
        <Card>
          <div className="text-apple-xs uppercase tracking-wide text-apple-text-tertiary">Family balance</div>
          <Money cents={family.balanceCents} className="mt-1 block text-apple-xl font-semibold text-apple-text" />
        </Card>
      </div>

      <Card padded={false}>
        <div className="px-4 pt-4"><CardHeader title={`Members (${family.members.length})`} /></div>
        <ul className="mt-2 divide-y divide-apple-divider">
          {family.members.map((m) => {
            const age = ageFromDob(m.dob);
            return (
              <li key={m.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <Avatar photoUrl={m.photoUrl} first={m.firstName} last={m.lastName} />
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-apple-sm">
                      {m.memberId === memberId ? (
                        <span className="font-semibold text-apple-text">{m.firstName} {m.lastName}</span>
                      ) : (
                        <Link href={adminRoutes.loc.members.detail(slug, m.memberId)} className="font-semibold text-apple-text hover:underline">{m.firstName} {m.lastName}</Link>
                      )}
                      {m.isPrimary && <Badge tone="info" size="sm"><Crown className="mr-1 inline h-3 w-3" />Primary</Badge>}
                      {!m.isPrimary && <Badge tone="muted" size="sm">{m.role.toLowerCase()}</Badge>}
                      <StatusBadge status={m.status} size="sm" />
                    </div>
                    <div className="text-apple-xs text-apple-text-tertiary">
                      {m.email}{age !== null ? ` · ${age} yrs` : ""}{m.subscription ? ` · ${m.subscription.planName}` : " · no membership"}{m.hasSharedCard ? " · shares card" : ""}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 sm:justify-end">
                  {!m.isPrimary && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => void run(() => api(`/api/admin/family/${family.id}`, { method: "PATCH", json: { primaryMemberId: m.memberId } }), "Primary member updated")}>Make primary</Button>
                      <Button size="sm" variant="ghost" onClick={() => setModal({ kind: "role", m })}>Role</Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" iconLeft={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { if (window.confirm(`Remove ${m.firstName} from the family?`)) void run(() => api(`/api/admin/family/${family.id}?memberId=${m.memberId}`, { method: "DELETE" }), "Removed from family"); }}>
                    Remove
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {me && (
        <div className="text-right">
          <Button variant="danger" size="sm" onClick={() => { if (window.confirm("Dissolve this family group? Members keep their own accounts.")) void run(() => api(`/api/admin/family/${family.id}`, { method: "DELETE" }), "Family dissolved"); }}>
            Dissolve family
          </Button>
        </div>
      )}

      {modal?.kind === "rename" && <NameModal title="Rename family" initial={family.name} busy={busy} onClose={() => setModal(null)} onSubmit={(name) => run(() => api(`/api/admin/family/${family.id}`, { method: "PATCH", json: { name } }), "Family renamed")} />}
      {modal?.kind === "add" && <AddMemberModal slug={slug} exclude={new Set(family.members.map((m) => m.memberId))} busy={busy} onClose={() => setModal(null)} onSubmit={(b) => run(() => api(`/api/admin/family/${family.id}`, { method: "POST", json: b }), "Added to family")} />}
      {modal?.kind === "role" && <RoleModal m={modal.m} busy={busy} onClose={() => setModal(null)} onSubmit={(role) => run(() => api(`/api/admin/family/${family.id}`, { method: "PATCH", json: { memberId: modal.m.memberId, role } }), "Role updated")} />}
    </div>
  );
}

function NameModal({ title, initial, busy, onClose, onSubmit }: { title: string; initial: string; busy: boolean; onClose: () => void; onSubmit: (name: string) => void }) {
  const [name, setName] = React.useState(initial);
  return (
    <Modal open onClose={onClose} title={title} footer={
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button loading={busy} onClick={() => onSubmit(name.trim())}>Save</Button>
      </div>
    }>
      <Input label="Family name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Smith family" />
    </Modal>
  );
}

function RoleModal({ m, busy, onClose, onSubmit }: { m: FamMember; busy: boolean; onClose: () => void; onSubmit: (role: string) => void }) {
  const [role, setRole] = React.useState(ROLES.includes(m.role) ? m.role : "OTHER");
  return (
    <Modal open onClose={onClose} title={`Role for ${m.firstName}`} footer={
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button loading={busy} onClick={() => onSubmit(role)}>Save</Button>
      </div>
    }>
      <Select label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
        {ROLES.map((r) => <option key={r} value={r}>{r.toLowerCase()}</option>)}
      </Select>
    </Modal>
  );
}

function AddMemberModal({ slug, exclude, busy, onClose, onSubmit }: { slug: string; exclude: Set<string>; busy: boolean; onClose: () => void; onSubmit: (b: { memberId: string; role: string }) => void }) {
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<SearchRow[]>([]);
  const [picked, setPicked] = React.useState<SearchRow | null>(null);
  const [role, setRole] = React.useState("CHILD");
  const [searching, setSearching] = React.useState(false);

  React.useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      setSearching(true);
      api<{ items: SearchRow[] }>(`/api/admin/members?locationSlug=${encodeURIComponent(slug)}&search=${encodeURIComponent(q.trim())}&pageSize=8`)
        .then((r) => setResults((r.items ?? []).filter((m) => !exclude.has(m.id))))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, slug, exclude]);

  return (
    <Modal open onClose={onClose} title="Add family member" description="Search for an existing member at this location." footer={
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button loading={busy} disabled={!picked} onClick={() => picked && onSubmit({ memberId: picked.id, role })}>Add</Button>
      </div>
    }>
      <div className="space-y-3">
        {picked ? (
          <div className="flex items-center justify-between rounded-apple-sm bg-apple-fill-secondary px-3 py-2 text-apple-sm">
            <span className="text-apple-text">{picked.firstName} {picked.lastName} <span className="text-apple-text-tertiary">· {picked.email}</span></span>
            <button type="button" className="text-apple-xs text-apple-blue" onClick={() => setPicked(null)}>Change</button>
          </div>
        ) : (
          <div>
            <Input prefix={<Search className="h-4 w-4" />} placeholder="Name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            {(results.length > 0 || searching) && (
              <div className="mt-1 overflow-hidden rounded-apple border border-apple-border">
                {searching && results.length === 0 && <div className="px-3 py-2 text-apple-xs text-apple-text-tertiary">Searching…</div>}
                {results.map((m) => (
                  <button key={m.id} type="button" onClick={() => setPicked(m)} className="flex w-full items-center justify-between px-3 py-2 text-left text-apple-sm hover:bg-apple-fill-secondary">
                    <span className="text-apple-text">{m.firstName} {m.lastName}</span>
                    <span className="text-apple-xs text-apple-text-tertiary">{m.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <Select label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map((r) => <option key={r} value={r}>{r.toLowerCase()}</option>)}
        </Select>
      </div>
    </Modal>
  );
}
