"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Modal, Money, Textarea, useToast } from "@/components/ui";
import { Plus, Trash2 } from "lucide-react";
import { MemberPicker, type MemberOption } from "./MemberPicker";

type Line = { description: string; amount: string; quantity: string };

/** "New invoice" modal → POST /api/admin/invoices (one-off invoice, optional pay link email). */
export function NewInvoiceButton({ slug, members, taxRateBps, currency = "USD", defaultMemberId }: { slug: string; members: MemberOption[]; taxRateBps: number; currency?: string; defaultMemberId?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [memberId, setMemberId] = React.useState(defaultMemberId ?? "");
  const [description, setDescription] = React.useState("");
  const [dueDate, setDueDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = React.useState<Line[]>([{ description: "", amount: "", quantity: "1" }]);
  const [applyTax, setApplyTax] = React.useState(taxRateBps > 0);
  const [discountCode, setDiscountCode] = React.useState("");
  const [sendPayLink, setSendPayLink] = React.useState(true);
  const [notes, setNotes] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const subtotal = lines.reduce((s, l) => s + Math.round(Number(l.amount || 0) * 100) * Math.max(1, Number(l.quantity || 1)), 0);
  const tax = applyTax ? Math.round((subtotal * taxRateBps) / 10_000) : 0;
  const valid = memberId && lines.some((l) => l.description.trim() && Number(l.amount) > 0);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationSlug: slug,
          memberId,
          description: description || undefined,
          dueDate,
          lines: lines.filter((l) => l.description.trim() && Number(l.amount) > 0).map((l) => ({ description: l.description.trim(), unitCents: Math.round(Number(l.amount) * 100), quantity: Math.max(1, Number(l.quantity || 1)) })),
          applyTax,
          discountCode: discountCode || undefined,
          sendPayLink,
          adminNotes: notes || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not create invoice");
      toast({ tone: "success", title: `Invoice #${json.invoice?.number ?? ""} created`, description: sendPayLink ? "Pay link emailed to the member." : undefined });
      setOpen(false);
      setLines([{ description: "", amount: "", quantity: "1" }]);
      setDescription("");
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Could not create invoice", description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>New invoice</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New invoice"
        description="One-off charge for a member. Taxes are calculated from the location rate; a card surcharge is added only if they pay by card."
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} loading={saving} disabled={!valid}>Create invoice</Button>
          </>
        }
      >
        <div className="space-y-4">
          <MemberPicker label="Member" members={members} value={memberId} onChange={setMemberId} disabled={Boolean(defaultMemberId)} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Guest fees" />
            <Input label="Due date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>

          <div>
            <div className="mb-1.5 text-apple-xs font-medium text-apple-text-secondary">Line items</div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_90px_60px_auto] items-end gap-2">
                  <Input placeholder="Item" value={l.description} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                  <Input placeholder="0.00" type="number" min={0} step="0.01" prefix="$" value={l.amount} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                  <Input type="number" min={1} value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                  <Button variant="ghost" size="sm" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button variant="link" size="sm" className="mt-2" onClick={() => setLines((ls) => [...ls, { description: "", amount: "", quantity: "1" }])}>+ Add line</Button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Discount code (optional)" value={discountCode} onChange={(e) => setDiscountCode(e.target.value.toUpperCase())} />
            <div className="space-y-2 pt-6 text-apple-sm">
              <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-apple-blue" checked={applyTax} onChange={(e) => setApplyTax(e.target.checked)} disabled={taxRateBps === 0} /> Apply tax ({(taxRateBps / 100).toFixed(2)}%)</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-apple-blue" checked={sendPayLink} onChange={(e) => setSendPayLink(e.target.checked)} /> Email pay link to member</label>
            </div>
          </div>
          <Textarea label="Internal notes (optional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />

          <div className="flex items-center justify-between rounded-apple-sm bg-apple-fill-secondary px-3 py-2 text-apple-sm">
            <span className="text-apple-text-secondary">Subtotal <Money cents={subtotal} currency={currency} />{tax > 0 && <> · Tax <Money cents={tax} currency={currency} /></>}</span>
            <span className="font-semibold text-apple-text">Total <Money cents={subtotal + tax} currency={currency} /></span>
          </div>
        </div>
      </Modal>
    </>
  );
}
