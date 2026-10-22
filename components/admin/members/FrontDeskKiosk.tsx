"use client";

import React from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Delete, FileSignature, QrCode, Search, UserPlus, Volume2, VolumeX } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { Badge, Button, Card, CardHeader, Input, Modal, Money, PageHeader, StatusBadge, useToast } from "@/components/ui";
import { Avatar, api, errMsg, fmtTime, relTime, type ApiError } from "./shared";

type FDMember = {
  id: string; firstName: string; lastName: string; email: string; phone: string; photoUrl: string | null; status: string; checkinCode: string | null;
  membership: { planName: string; status: string; paidThroughDate: string | null; freezeResumeDate: string | null } | null;
  balanceCents: number; overdueCents: number;
  unsignedRequiredDocs: Array<{ documentId: string; name: string; assignmentId: string | null; signingUrl: string | null }>;
  lastVisitAt: string | null; todayVisitAt: string | null;
};
type CheckInResult =
  | { ok: true; visitId: string; type: string; alreadyCheckedIn: false; member: FDMember }
  | { ok: true; visitId: string; type: string; alreadyCheckedIn: true; at: string; member: FDMember }
  | { ok: false; blocked: true; reason: string; code: "MEMBERSHIP" | "DOCUMENT" | "OVERDUE"; member: FDMember };
type RecentVisit = { id: string; enteredAt: string; type: string; source: string; member: { id: string; firstName: string; lastName: string; photoUrl: string | null; status: string } | null; visitor: { id: string; firstName: string; lastName: string } | null; bay: { number: number } | null };

type Mode = "code" | "search" | "scan";

export function FrontDeskKiosk({ slug, locationName, dedupeHours }: { slug: string; locationName: string; dedupeHours: number }) {
  const { toast } = useToast();
  const [mode, setMode] = React.useState<Mode>("code");
  const [code, setCode] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [scan, setScan] = React.useState("");
  const [results, setResults] = React.useState<FDMember[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [outcome, setOutcome] = React.useState<CheckInResult | { ok: false; notFound: true } | null>(null);
  const [recent, setRecent] = React.useState<RecentVisit[]>([]);
  const [walkInOpen, setWalkInOpen] = React.useState(false);
  const [sound, setSound] = React.useState(true);
  const scanRef = React.useRef<HTMLInputElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const dismissTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadRecent = React.useCallback(() => {
    api<{ visits: RecentVisit[] }>(`/api/admin/front-desk/recent?locationSlug=${encodeURIComponent(slug)}`).then((r) => setRecent(r.visits ?? [])).catch(() => {});
  }, [slug]);
  React.useEffect(() => { loadRecent(); const t = setInterval(loadRecent, 30_000); return () => clearInterval(t); }, [loadRecent]);

  React.useEffect(() => {
    if (mode === "scan") setTimeout(() => scanRef.current?.focus(), 50);
    if (mode === "search") setTimeout(() => searchRef.current?.focus(), 50);
  }, [mode]);

  // Name / phone search (debounced)
  React.useEffect(() => {
    if (mode !== "search") return;
    if (query.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      setSearching(true);
      api<{ results: FDMember[] }>(`/api/admin/front-desk/lookup?locationSlug=${encodeURIComponent(slug)}&q=${encodeURIComponent(query.trim())}`)
        .then((r) => setResults(r.results ?? []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query, mode, slug]);

  // Keypad keyboard support
  React.useEffect(() => {
    if (mode !== "code") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (/^\d$/.test(e.key)) setCode((c) => (c.length < 8 ? c + e.key : c));
      else if (e.key === "Backspace") setCode((c) => c.slice(0, -1));
      else if (e.key === "Enter") void submit({ code });
      else if (e.key === "Escape") { setCode(""); setOutcome(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, code]);

  function beep(kind: "ok" | "warn" | "error") {
    if (!sound) return;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const tones = kind === "ok" ? [[880, 0.08], [1320, 0.12]] : kind === "warn" ? [[660, 0.15]] : [[220, 0.12], [180, 0.2]];
      let t = ctx.currentTime;
      for (const [freq, dur] of tones) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.2, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g).connect(ctx.destination);
        o.start(t);
        o.stop(t + dur);
        t += dur;
      }
      setTimeout(() => void ctx.close(), 1000);
    } catch { /* no audio */ }
  }

  function showOutcome(o: CheckInResult | { ok: false; notFound: true }) {
    setOutcome(o);
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    if (o.ok && !o.alreadyCheckedIn) dismissTimer.current = setTimeout(() => setOutcome(null), 6000);
  }

  async function submit(payload: { code?: string; scan?: string; memberId?: string; override?: boolean }) {
    if (!payload.code && !payload.scan && !payload.memberId) return;
    setBusy(true);
    try {
      const r = await api<CheckInResult>(`/api/admin/front-desk/check-in`, { method: "POST", json: { locationSlug: slug, ...payload } });
      beep(r.ok ? (r.alreadyCheckedIn ? "warn" : "ok") : "error");
      showOutcome(r);
      setCode(""); setScan(""); setQuery(""); setResults([]);
      loadRecent();
    } catch (err) {
      const e = err as ApiError;
      if (e?.status === 409 && e?.data?.blocked) { beep("error"); showOutcome(e.data as unknown as CheckInResult); }
      else if (e?.status === 404 && e?.data?.notFound) { beep("error"); showOutcome({ ok: false, notFound: true }); }
      else toast({ tone: "error", title: "Check-in failed", description: errMsg(e) });
      setCode(""); setScan("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Front desk"
        description={`${locationName} · check-ins roll up within ${dedupeHours}h`}
        actions={
          <>
            <Button variant="ghost" size="sm" iconLeft={sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />} onClick={() => setSound((s) => !s)}>{sound ? "Sound on" : "Muted"}</Button>
            <Button variant="secondary" iconLeft={<UserPlus className="h-4 w-4" />} onClick={() => setWalkInOpen(true)}>Walk-in guest</Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <div className="flex gap-1 rounded-apple bg-apple-fill-secondary p-1">
            {([["code", "Code"], ["search", "Name / phone"], ["scan", "QR scan"]] as [Mode, string][]).map(([m, label]) => (
              <button key={m} type="button" onClick={() => { setMode(m); setOutcome(null); }} className={`flex-1 rounded-apple-sm py-2 text-apple-sm font-medium transition-colors ${mode === m ? "bg-white text-apple-text shadow-apple-sm" : "text-apple-text-secondary hover:text-apple-text"}`}>
                {label}
              </button>
            ))}
          </div>

          {outcome && <Outcome o={outcome} slug={slug} busy={busy} onOverride={(id) => void submit({ memberId: id, override: true })} onDismiss={() => setOutcome(null)} />}

          {mode === "code" && (
            <Card className="mx-auto w-full max-w-sm">
              <div className="mb-4 flex h-16 items-center justify-center rounded-apple bg-apple-fill-secondary font-mono text-apple-3xl tracking-[0.4em] text-apple-text">
                {code ? code.replace(/\d/g, "•") : <span className="text-apple-base tracking-normal text-apple-text-tertiary">Enter check-in code</span>}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => <Key key={d} onClick={() => setCode((c) => (c.length < 8 ? c + d : c))}>{d}</Key>)}
                <Key onClick={() => setCode((c) => c.slice(0, -1))} aria-label="Delete"><Delete className="mx-auto h-5 w-5" /></Key>
                <Key onClick={() => setCode((c) => (c.length < 8 ? c + "0" : c))}>0</Key>
                <button type="button" disabled={code.length < 4 || busy} onClick={() => void submit({ code })} className="h-14 rounded-apple bg-apple-green text-apple-base font-semibold text-white hover:opacity-90 disabled:opacity-40" aria-label="Check in">
                  <CheckCircle2 className="mx-auto h-6 w-6" />
                </button>
              </div>
              <p className="mt-3 text-center text-apple-xs text-apple-text-tertiary">Type on the keyboard or tap. Enter to check in.</p>
            </Card>
          )}

          {mode === "search" && (
            <Card>
              <Input ref={searchRef} prefix={<Search className="h-4 w-4" />} placeholder="Start typing a name, phone or email…" value={query} onChange={(e) => setQuery(e.target.value)} className="text-apple-base" />
              <div className="mt-3 divide-y divide-apple-divider">
                {searching && results.length === 0 && <p className="py-3 text-apple-sm text-apple-text-tertiary">Searching…</p>}
                {!searching && query.trim().length >= 2 && results.length === 0 && (
                  <div className="py-3 text-apple-sm text-apple-text-tertiary">
                    No match. <button type="button" className="font-medium text-apple-blue" onClick={() => setWalkInOpen(true)}>Add as walk-in guest</button> or <Link href={adminRoutes.loc.members.new(slug)} className="font-medium text-apple-blue">create a member</Link>.
                  </div>
                )}
                {results.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar photoUrl={m.photoUrl} first={m.firstName} last={m.lastName} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 text-apple-sm">
                          <span className="font-medium text-apple-text">{m.firstName} {m.lastName}</span>
                          <StatusBadge status={m.status} size="sm" />
                          {m.todayVisitAt && <Badge tone="info" size="sm">In today {fmtTime(m.todayVisitAt)}</Badge>}
                        </div>
                        <div className="truncate text-apple-xs text-apple-text-tertiary">{m.membership?.planName ?? "No membership"} · {m.phone || m.email}</div>
                      </div>
                    </div>
                    <Button size="sm" loading={busy} onClick={() => void submit({ memberId: m.id })}>Check in</Button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {mode === "scan" && (
            <Card className="text-center">
              <QrCode className="mx-auto mb-2 h-10 w-10 text-apple-text-tertiary" />
              <p className="text-apple-sm text-apple-text-secondary">Point a USB/Bluetooth scanner at the member&apos;s portal QR code. The field below stays focused; scanners &ldquo;type&rdquo; the code and press Enter.</p>
              <div className="mx-auto mt-4 max-w-md">
                <Input
                  ref={scanRef}
                  value={scan}
                  placeholder="Waiting for scan…"
                  onChange={(e) => setScan(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && scan.trim()) void submit({ scan: scan.trim() }); }}
                  onBlur={() => setTimeout(() => mode === "scan" && !walkInOpen && scanRef.current?.focus(), 100)}
                  autoComplete="off"
                />
              </div>
            </Card>
          )}
        </div>

        <div className="lg:col-span-2">
          <Card padded={false}>
            <div className="px-4 pt-4"><CardHeader title="Today" subtitle={`${recent.length} check-in${recent.length === 1 ? "" : "s"}`} /></div>
            {recent.length === 0 ? (
              <p className="px-4 py-6 text-apple-sm text-apple-text-tertiary">No check-ins yet today.</p>
            ) : (
              <ul className="mt-2 max-h-[70vh] divide-y divide-apple-divider overflow-y-auto">
                {recent.map((v) => (
                  <li key={v.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Avatar photoUrl={v.member?.photoUrl} first={v.member?.firstName ?? v.visitor?.firstName} last={v.member?.lastName ?? v.visitor?.lastName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-apple-sm text-apple-text">
                        {v.member ? (
                          <Link href={adminRoutes.loc.members.detail(slug, v.member.id)} className="font-medium hover:underline">{v.member.firstName} {v.member.lastName}</Link>
                        ) : (
                          <span className="font-medium">{v.visitor ? `${v.visitor.firstName} ${v.visitor.lastName}` : "Guest"} <Badge tone="muted" size="sm">guest</Badge></span>
                        )}
                      </div>
                      <div className="text-apple-xs text-apple-text-tertiary">{v.type.replace(/_/g, " ").toLowerCase()} · {v.source.replace(/_/g, " ").toLowerCase()}{v.bay ? ` · Bay ${v.bay.number}` : ""}</div>
                    </div>
                    <span className="shrink-0 text-apple-xs text-apple-text-secondary">{fmtTime(v.enteredAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <WalkInModal slug={slug} open={walkInOpen} initialName={mode === "search" ? query : ""} onClose={() => setWalkInOpen(false)} onDone={() => { beep("ok"); loadRecent(); setQuery(""); }} />
    </div>
  );
}

function Key({ children, onClick, ...rest }: { children: React.ReactNode; onClick: () => void } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" onClick={onClick} className="h-14 rounded-apple bg-apple-fill-secondary text-apple-xl font-medium text-apple-text hover:bg-apple-fill-tertiary active:scale-95" {...rest}>
      {children}
    </button>
  );
}

function Outcome({ o, slug, busy, onOverride, onDismiss }: { o: CheckInResult | { ok: false; notFound: true }; slug: string; busy: boolean; onOverride: (memberId: string) => void; onDismiss: () => void }) {
  if ("notFound" in o) {
    return (
      <div className="flex items-center justify-between rounded-apple border border-apple-red/30 bg-apple-red/5 p-4 text-apple-sm text-apple-red">
        <span className="flex items-center gap-2"><AlertTriangle className="h-5 w-5" /> No member matches that code.</span>
        <button type="button" onClick={onDismiss} className="text-apple-xs font-medium underline">Dismiss</button>
      </div>
    );
  }
  const m = o.member;
  const tone = o.ok ? (o.alreadyCheckedIn ? "border-apple-orange/30 bg-apple-orange/5" : "border-apple-green/30 bg-apple-green/5") : "border-apple-red/30 bg-apple-red/5";
  return (
    <div className={`rounded-apple border p-4 ${tone}`}>
      <div className="flex items-start gap-4">
        <Avatar photoUrl={m.photoUrl} first={m.firstName} last={m.lastName} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={adminRoutes.loc.members.detail(slug, m.id)} className="text-apple-xl font-semibold text-apple-text hover:underline">{m.firstName} {m.lastName}</Link>
            <StatusBadge status={m.status} size="sm" />
          </div>
          <div className="text-apple-sm text-apple-text-secondary">
            {m.membership ? `${m.membership.planName} · ${m.membership.status.replace(/_/g, " ").toLowerCase()}` : "No membership"}
            {m.lastVisitAt && ` · last visit ${relTime(m.lastVisitAt)}`}
          </div>
          <div className="mt-2 text-apple-base font-medium">
            {o.ok && !o.alreadyCheckedIn && <span className="flex items-center gap-2 text-apple-green"><CheckCircle2 className="h-5 w-5" /> Checked in · {o.type.replace(/_/g, " ").toLowerCase()}</span>}
            {o.ok && o.alreadyCheckedIn && <span className="flex items-center gap-2 text-apple-orange"><AlertTriangle className="h-5 w-5" /> Already checked in at {fmtTime(o.at)}</span>}
            {!o.ok && <span className="flex items-center gap-2 text-apple-red"><AlertTriangle className="h-5 w-5" /> {o.reason}</span>}
          </div>
          {m.overdueCents > 0 && <div className="mt-1 text-apple-sm text-apple-red">Overdue balance <Money cents={m.overdueCents} className="font-semibold" /></div>}
          {m.unsignedRequiredDocs.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {m.unsignedRequiredDocs.map((d) => d.signingUrl ? (
                <a key={d.documentId} href={d.signingUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-apple-sm bg-apple-blue px-3 text-apple-xs font-medium text-white hover:bg-apple-blue-hover">
                  <FileSignature className="h-3.5 w-3.5" /> Sign {d.name} now
                </a>
              ) : (
                <Link key={d.documentId} href={adminRoutes.loc.members.detailTab(slug, m.id, "documents")} className="inline-flex h-8 items-center gap-1 rounded-apple-sm border border-apple-border bg-white px-3 text-apple-xs font-medium text-apple-text hover:bg-apple-fill-secondary">
                  <FileSignature className="h-3.5 w-3.5" /> Assign {d.name}
                </Link>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {!o.ok && <Button size="sm" variant="danger" loading={busy} onClick={() => onOverride(m.id)}>Override & check in</Button>}
            {!o.ok && o.code === "OVERDUE" && <Link href={adminRoutes.loc.members.detailTab(slug, m.id, "payments")} className="inline-flex h-8 items-center rounded-apple-sm border border-apple-border bg-white px-3 text-apple-xs font-medium text-apple-text hover:bg-apple-fill-secondary">Take payment</Link>}
            {!o.ok && o.code === "MEMBERSHIP" && <Link href={adminRoutes.loc.members.detailTab(slug, m.id, "memberships")} className="inline-flex h-8 items-center rounded-apple-sm border border-apple-border bg-white px-3 text-apple-xs font-medium text-apple-text hover:bg-apple-fill-secondary">Fix membership</Link>}
            <Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function WalkInModal({ slug, open, initialName, onClose, onDone }: { slug: string; open: boolean; initialName: string; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (open) { setName(/\d/.test(initialName) ? "" : initialName); setPhone(/\d/.test(initialName) ? initialName : ""); setEmail(""); } }, [open, initialName]);

  async function save() {
    setBusy(true);
    try {
      await api(`/api/admin/front-desk/walk-in`, { method: "POST", json: { locationSlug: slug, name: name.trim(), phone: phone.trim() || undefined, email: email.trim() || undefined } });
      toast({ tone: "success", title: `${name.trim()} checked in as a guest` });
      onDone();
      onClose();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't add guest", description: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Walk-in guest" description="Records a visit and creates a lead so marketing can follow up." footer={
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button loading={busy} disabled={!name.trim()} onClick={() => void save()}>Check in guest</Button>
      </div>
    }>
      <div className="space-y-3">
        <Input label="Name *" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <Input label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
    </Modal>
  );
}
