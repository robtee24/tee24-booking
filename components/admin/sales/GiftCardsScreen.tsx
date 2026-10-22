// components/admin/sales/GiftCardsScreen.tsx
"use client";

import React from "react";
import { Ban, Gift, Plus, Search, SlidersHorizontal } from "lucide-react";
import { Badge, Button, DataTable, Drawer, Input, Modal, PageHeader, Select, StatusBadge, formatMoney, useToast, type Column } from "@/components/ui";
import { posFetch, qs } from "./api";
import { centsToDollarsInput, parseDollarsToCents } from "./pos-math";
import type { GiftCardDTO, GiftCardLookupDTO } from "./types";

export function GiftCardsScreen({ slug }: { slug: string }) {
  const { toast } = useToast();
  const [cards, setCards] = React.useState<GiftCardDTO[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("ALL");
  const [issueOpen, setIssueOpen] = React.useState(false);
  const [issued, setIssued] = React.useState<{ code: string; amountCents: number } | null>(null);
  const [selected, setSelected] = React.useState<GiftCardDTO | null>(null);
  const [lookupCode, setLookupCode] = React.useState("");
  const [lookup, setLookup] = React.useState<GiftCardLookupDTO | null>(null);
  const [lookupErr, setLookupErr] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const r = await posFetch<{ giftCards: GiftCardDTO[] }>(`/api/admin/gift-cards${qs({ locationSlug: slug, q, status })}`);
      setCards(r.giftCards);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load gift cards");
    }
  }, [slug, q, status]);

  React.useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function doLookup() {
    setLookup(null); setLookupErr(null);
    try {
      const r = await posFetch<{ giftCard: GiftCardLookupDTO }>(`/api/admin/gift-cards/lookup${qs({ locationSlug: slug, code: lookupCode })}`);
      setLookup(r.giftCard);
    } catch (e) {
      setLookupErr(e instanceof Error ? e.message : "Not found");
    }
  }

  const outstanding = (cards ?? []).filter((c) => c.status === "ACTIVE").reduce((a, c) => a + c.balanceCents, 0);

  const columns: Column<GiftCardDTO>[] = [
    { key: "code", header: "Code", cell: (c) => <span className="font-mono text-apple-sm">{c.codeMasked}</span> },
    { key: "balance", header: "Balance", align: "right", cell: (c) => <span className="font-medium tabular-nums">{formatMoney(c.balanceCents)}<span className="text-apple-xs text-apple-text-tertiary"> / {formatMoney(c.initialCents)}</span></span> },
    { key: "status", header: "Status", cell: (c) => <StatusBadge status={c.status === "DEPLETED" ? "INACTIVE" : c.status === "VOID" ? "CANCELLED" : c.status} size="sm" /> },
    { key: "recipient", header: "Recipient", cell: (c) => <div className="min-w-0"><div className="truncate">{c.recipientName ?? "—"}</div>{c.recipientEmail && <div className="truncate text-apple-xs text-apple-text-tertiary">{c.recipientEmail}</div>}</div> },
    { key: "purchaser", header: "Purchaser", cell: (c) => <span className="text-apple-text-secondary">{c.purchaserName ?? (c.purchaserMemberId ? "Member" : "—")}</span> },
    { key: "expires", header: "Expires", cell: (c) => <span className="text-apple-text-secondary">{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "Never"}</span> },
    { key: "created", header: "Issued", cell: (c) => <span className="whitespace-nowrap text-apple-text-secondary">{new Date(c.createdAt).toLocaleDateString()}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gift Cards"
        description="Sold from the New Sale screen or issued here. Redeem by code at checkout."
        meta={cards && <><Badge tone="muted">{cards.length} cards</Badge><Badge tone="info">{formatMoney(outstanding)} outstanding</Badge></>}
        actions={<Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => setIssueOpen(true)}>Issue gift card</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex-1"><Input prefix={<Search className="h-4 w-4" />} placeholder="Recipient name, email, or last 4…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ALL">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="DEPLETED">Depleted</option>
              <option value="VOID">Void</option>
            </Select>
          </div>
          {error && <div className="rounded-apple border border-apple-red/30 bg-apple-red/5 p-4 text-apple-sm text-apple-red">{error}</div>}
          <DataTable columns={columns} rows={cards ?? []} rowKey={(c) => c.id} loading={!cards && !error} onRowClick={setSelected} empty={<span className="inline-flex items-center gap-2"><Gift className="h-4 w-4" /> No gift cards yet.</span>} />
        </div>

        <div className="rounded-apple bg-white p-4 shadow-apple">
          <h2 className="text-apple-base font-semibold text-apple-text">Check a balance</h2>
          <p className="mt-0.5 text-apple-xs text-apple-text-secondary">Enter the full 16-character code from the customer&apos;s card or email.</p>
          <div className="mt-3 flex gap-2">
            <Input placeholder="XXXX-XXXX-XXXX-XXXX" className="font-mono uppercase tracking-wider" value={lookupCode} autoCapitalize="characters" onChange={(e) => setLookupCode(fmtCode(e.target.value))} onKeyDown={(e) => e.key === "Enter" && void doLookup()} />
            <Button variant="secondary" disabled={lookupCode.replace(/-/g, "").length < 16} onClick={() => void doLookup()}>Check</Button>
          </div>
          {lookupErr && <p className="mt-2 text-apple-sm text-apple-red">{lookupErr}</p>}
          {lookup && (
            <div className={["mt-3 rounded-apple-sm border p-3 text-apple-sm", lookup.usable ? "border-apple-green/30 bg-apple-green/5" : "border-apple-orange/30 bg-apple-orange/5"].join(" ")}>
              <div className="flex items-center justify-between"><span className="font-mono">{lookup.codeMasked}</span><StatusBadge status={lookup.status === "DEPLETED" ? "INACTIVE" : lookup.status === "VOID" ? "CANCELLED" : lookup.status} size="sm" /></div>
              <div className="mt-1 text-apple-xl font-semibold tabular-nums">{formatMoney(lookup.balanceCents)}</div>
              <div className="text-apple-xs text-apple-text-secondary">{lookup.reason ?? `of ${formatMoney(lookup.initialCents)} · ${lookup.recipientName ?? "no recipient"}`}</div>
              <Button size="sm" variant="secondary" className="mt-2" onClick={() => { const c = cards?.find((x) => x.id === lookup.id); if (c) setSelected(c); }}>Manage</Button>
            </div>
          )}
        </div>
      </div>

      <IssueModal open={issueOpen} onClose={() => setIssueOpen(false)} slug={slug} onIssued={(r) => { setIssued(r); setIssueOpen(false); void load(); }} />

      <Modal open={issued !== null} onClose={() => setIssued(null)} title="Gift card issued" description="Write this code down or send it now — it's masked everywhere else.">
        {issued && (
          <div className="space-y-3 text-center">
            <div className="text-apple-2xl font-semibold tabular-nums">{formatMoney(issued.amountCents)}</div>
            <div className="rounded-apple-sm bg-apple-fill-secondary p-4 font-mono text-apple-xl tracking-widest">{issued.code}</div>
            <Button variant="secondary" onClick={() => { void navigator.clipboard?.writeText(issued.code); toast({ tone: "success", title: "Code copied" }); }}>Copy code</Button>
          </div>
        )}
      </Modal>

      <ManageDrawer slug={slug} card={selected} onClose={() => setSelected(null)} onChanged={(c) => { setSelected(c); void load(); }} />
    </div>
  );
}

function fmtCode(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
  return (s.match(/.{1,4}/g) ?? []).join("-");
}

function IssueModal({ open, onClose, slug, onIssued }: { open: boolean; onClose: () => void; slug: string; onIssued: (r: { code: string; amountCents: number }) => void }) {
  const [amount, setAmount] = React.useState("");
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [expires, setExpires] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    const cents = parseDollarsToCents(amount);
    if (cents == null || cents < 100) return setErr("Amount must be at least $1");
    setBusy(true); setErr(null);
    try {
      const r = await posFetch<{ giftCard: GiftCardDTO & { code: string } }>("/api/admin/gift-cards", {
        method: "POST",
        body: JSON.stringify({ locationSlug: slug, amountCents: cents, recipientName: name, recipientEmail: email, expiresAt: expires ? new Date(expires).toISOString() : null, reason }),
      });
      onIssued({ code: r.giftCard.code, amountCents: cents });
      setAmount(""); setName(""); setEmail(""); setExpires(""); setReason("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Issue a gift card" description="For comps, promotions, or make-goods. No sale is recorded — to sell one, use New Sale → Sell gift card."
      footer={<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={() => void submit()} iconLeft={<Gift className="h-4 w-4" />}>Issue</Button></div>}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {[2500, 5000, 10000].map((c) => <Button key={c} size="sm" variant={parseDollarsToCents(amount) === c ? "primary" : "secondary"} onClick={() => setAmount(centsToDollarsInput(c))}>{formatMoney(c)}</Button>)}
        </div>
        <Input label="Amount" prefix="$" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25.00" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Recipient name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Recipient email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Expires (optional)" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Comp — tournament prize" hint="Stored in the audit log." />
        </div>
        {err && <p className="text-apple-sm text-apple-red">{err}</p>}
      </div>
    </Modal>
  );
}

function ManageDrawer({ slug, card, onClose, onChanged }: { slug: string; card: GiftCardDTO | null; onClose: () => void; onChanged: (c: GiftCardDTO) => void }) {
  const { toast } = useToast();
  const [delta, setDelta] = React.useState("");
  const [sign, setSign] = React.useState<1 | -1>(1);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [voidOpen, setVoidOpen] = React.useState(false);

  React.useEffect(() => { setDelta(""); setSign(1); setReason(""); }, [card?.id]);
  if (!card) return <Drawer open={false} onClose={onClose}><span /></Drawer>;

  async function patch(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    try {
      const r = await posFetch<{ giftCard: GiftCardDTO }>(`/api/admin/gift-cards/${encodeURIComponent(card!.id)}`, { method: "PATCH", body: JSON.stringify({ locationSlug: slug, ...body }) });
      toast({ tone: "success", title: ok });
      setVoidOpen(false); setDelta(""); setReason("");
      onChanged(r.giftCard);
    } catch (e) {
      toast({ tone: "error", title: "Couldn't update", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  const cents = parseDollarsToCents(delta);

  return (
    <Drawer open onClose={onClose} title={`Gift card ${card.codeMasked}`} description={`Issued ${new Date(card.createdAt).toLocaleDateString()}`} width="md"
      footer={<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{card.status !== "VOID" && <Button variant="danger" iconLeft={<Ban className="h-4 w-4" />} onClick={() => setVoidOpen(true)}>Void card</Button>}<Button variant="secondary" onClick={onClose}>Close</Button></div>}>
      <div className="space-y-6">
        <div className="rounded-apple border border-apple-border p-4">
          <div className="flex items-center justify-between"><span className="text-apple-xs uppercase tracking-wide text-apple-text-tertiary">Balance</span><StatusBadge status={card.status === "DEPLETED" ? "INACTIVE" : card.status === "VOID" ? "CANCELLED" : card.status} size="sm" /></div>
          <div className="mt-1 text-apple-2xl font-semibold tabular-nums">{formatMoney(card.balanceCents)}</div>
          <div className="text-apple-xs text-apple-text-secondary">Initial {formatMoney(card.initialCents)} · {card.expiresAt ? `expires ${new Date(card.expiresAt).toLocaleDateString()}` : "never expires"}</div>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-apple-sm">
          <div><dt className="text-apple-xs text-apple-text-tertiary">Recipient</dt><dd>{card.recipientName ?? "—"}{card.recipientEmail && <div className="text-apple-xs text-apple-text-secondary">{card.recipientEmail}</div>}</dd></div>
          <div><dt className="text-apple-xs text-apple-text-tertiary">Purchaser</dt><dd>{card.purchaserName ?? (card.purchaserMemberId ? "Member" : "—")}</dd></div>
        </dl>

        {card.status !== "VOID" && (
          <section className="space-y-3">
            <h3 className="flex items-center gap-1.5 text-apple-xs font-semibold uppercase tracking-wide text-apple-text-tertiary"><SlidersHorizontal className="h-3.5 w-3.5" /> Adjust balance</h3>
            <div className="flex gap-2">
              <div className="flex overflow-hidden rounded-apple-sm border border-apple-border">
                <button type="button" onClick={() => setSign(1)} className={["px-3 text-apple-base font-semibold", sign === 1 ? "bg-apple-green text-white" : "bg-white text-apple-text-secondary"].join(" ")}>+</button>
                <button type="button" onClick={() => setSign(-1)} className={["px-3 text-apple-base font-semibold", sign === -1 ? "bg-apple-red text-white" : "bg-white text-apple-text-secondary"].join(" ")}>−</button>
              </div>
              <Input prefix="$" inputMode="decimal" placeholder="0.00" value={delta} onChange={(e) => setDelta(e.target.value)} />
            </div>
            <Input label="Reason (required, kept in audit log)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Goodwill credit / correction" />
            <Button variant="secondary" loading={busy} disabled={!cents || !reason.trim()} onClick={() => void patch({ action: "adjust", deltaCents: (cents ?? 0) * sign, reason }, "Balance adjusted")}>
              {sign === 1 ? "Add" : "Remove"} {cents ? formatMoney(cents) : ""}
            </Button>
          </section>
        )}
      </div>

      <Modal open={voidOpen} onClose={() => !busy && setVoidOpen(false)} title="Void this gift card?" description="The remaining balance can't be redeemed. This cannot be undone."
        footer={<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="secondary" onClick={() => setVoidOpen(false)} disabled={busy}>Keep</Button><Button variant="danger" loading={busy} onClick={() => void patch({ action: "void", reason }, "Gift card voided")}>Void</Button></div>}>
        <Input label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </Drawer>
  );
}
